const title = "YouTube 送中检测";
const groupName = "Proxy";
const groupSection = "Proxy Group";
const sectionURL = "/v1/profiles/section?name=Proxy%20Group";
const sectionsURL = "/v1/profiles/sections";
// The leading lookahead distinguishes this script's filters from hand-written ones.
const filterPrefix = "^(?=.)(?!(?:";
const filterSuffix = ")$).+";

function api(method, path, body = null) {
    return new Promise(resolve => $httpAPI(method, path, body, resolve));
}

function requestPremium(policy, useConsentCookie) {
    return new Promise(resolve => {
        const headers = {
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        };
        if (useConsentCookie) headers.Cookie = "SOCS=CAI";
        $httpClient.get({
            url: "https://www.youtube.com/premium",
            policy, headers, timeout: 8,
            "auto-cookie": false,
            "auto-redirect": false,
        }, (error, response, data) => resolve({error, response, data}));
    });
}

function classifyPage({error, response, data}) {
    if (error || response?.status !== 200 || typeof data !== "string") return "unknown";

    const regions = new Set(Array.from(
        data.matchAll(/"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Z]{2})"/g),
        match => match[1],
    ));
    const unavailable = /YouTube Premium is not available in your country/i.test(data);
    const mainlandAdService = /https:\/\/www\.google\.cn\/pagead\//i.test(data);
    if (unavailable && mainlandAdService) return "CN";
    if (regions.size !== 1) return "unknown";

    const [region] = regions;
    if (region === "CN") return "CN";
    return !unavailable && /\bad[- ]free\b/i.test(data) ? region : "unknown";
}

async function probe(name) {
    let useConsentCookie = false;
    let sample = await requestPremium(name, useConsentCookie);
    const location = Object.entries(sample.response?.headers ?? {})
        .find(([key]) => key.toLowerCase() === "location")?.[1];
    if ([301, 302, 303, 307, 308].includes(sample.response?.status) &&
        /^https:\/\/consent\.youtube\.com\//i.test(location || "")) {
        useConsentCookie = true;
        sample = await requestPremium(name, useConsentCookie);
    }

    let region = classifyPage(sample);
    if (region === "CN" && classifyPage(await requestPremium(name, useConsentCookie)) !== "CN") {
        region = "unknown";
    }
    return {name, region};
}

function readProxyGroup(section) {
    if (!section?.editable || typeof section.revision !== "string" ||
        typeof section.content !== "string") {
        throw new Error("当前配置的策略组无法编辑");
    }

    const lines = section.content.split("\n");
    const matchingLines = lines.flatMap((line, index) => /^\s*Proxy\s*=/.test(line) ? [index] : []);
    if (matchingLines.length !== 1) throw new Error("当前配置中找不到唯一的 Proxy 策略组");

    const [lineIndex] = matchingLines;
    const line = lines[lineIndex];
    const options = line.slice(line.indexOf("=") + 1).match(/(?:"[^"]*"|'[^']*'|[^,"'])+/g)
        ?.map(option => option.trim()) ?? [];
    const [type, ...parameters] = options;
    const includesAll = parameters.some(parameter => /^include-all-proxies\s*=\s*(?:1|true)$/i.test(parameter));
    const unsupported = parameters.some(parameter =>
        !parameter.includes("=") || /^(?:policy-path|include-other-group|underlying-proxy)\s*=/.test(parameter));
    if (type !== "smart" || !includesAll || unsupported) {
        throw new Error("Proxy 须为自动纳入本地节点的 Smart 组");
    }

    const filterField = /,\s*policy-regex-filter\s*=\s*"([^"]*)"/g;
    const filters = Array.from(line.matchAll(filterField));
    const hasFilter = parameters.some(parameter => /^policy-regex-filter\s*=/.test(parameter));
    const [field] = filters;
    const value = field?.[1];
    const managed = value?.startsWith(filterPrefix) && value.endsWith(filterSuffix);
    if (hasFilter && (filters.length !== 1 || !managed)) {
        throw new Error("Proxy 已有自定义节点筛选，请先检查该设置");
    }
    return {lines, lineIndex, field, currentFilter: value ? new RegExp(value, "u") : null};
}

function filterExactName(name) {
    // Escape regex metacharacters and profile delimiters without putting literal commas or quotes in the field.
    return name.replace(/[\\^$.*+?()[\]{}|,"'\x00-\x1f]/g, char =>
        "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
}

function configureFilter(group, excluded) {
    const {lines, lineIndex, field} = group;
    const filter = excluded.length
        ? ', policy-regex-filter="' + filterPrefix + excluded.map(filterExactName).join("|") + filterSuffix + '"'
        : "";
    const line = lines[lineIndex];
    // Slice the original field so other parameters, comments and lines retain their original text.
    if (field) {
        lines[lineIndex] = line.slice(0, field.index) + filter + line.slice(field.index + field[0].length);
    } else if (filter) {
        lines[lineIndex] = line.replace(/(\r?)$/, filter + "$1");
    }
    return lines.join("\n");
}

async function refresh() {
    const [profile, section, policies] = await Promise.all([
        api("GET", sectionsURL),
        api("GET", sectionURL),
        api("GET", "/v1/policies"),
    ]);
    const group = readProxyGroup(section);
    const names = Array.isArray(policies?.proxies) ? [...new Set(policies.proxies)] : [];
    if (typeof profile?.path !== "string" || !names.length ||
        names.some(name => typeof name !== "string" || !name)) {
        throw new Error("读取当前配置或节点列表失败");
    }

    const results = [];
    for (let offset = 0; offset < names.length; offset += 10) {
        results.push(...await Promise.all(names.slice(offset, offset + 10).map(probe)));
    }

    const good = results.filter(item => item.region !== "CN" && item.region !== "unknown");
    const mainland = results.filter(item => item.region === "CN");
    const unknown = results.filter(item => item.region === "unknown");
    const excluded = results.filter(({name, region}) =>
        region === "CN" || (region === "unknown" && group.currentFilter && !group.currentFilter.test(name)))
        .map(item => item.name);
    const restored = good.filter(({name}) => group.currentFilter && !group.currentFilter.test(name));

    const lines = [
        groupName + " · 正常 " + good.length + " · 送中 " + mainland.length + " · 无法判定 " + unknown.length,
    ];
    if (mainland.length) lines.push("送中：" + mainland.map(item => item.name).join("、"));
    if (unknown.length) lines.push("无法判定：" + unknown.map(item => item.name).join("、"));
    if (!good.length) {
        lines.push("本次没有确认正常的节点，保留现有候选。");
        return {title, content: lines.join("\n"), style: "alert"};
    }

    const updated = configureFilter(group, excluded);
    if (updated !== section.content) {
        const currentProfile = await api("GET", sectionsURL);
        if (currentProfile?.path !== profile.path) throw new Error("检测期间配置已切换，请重新刷新");
        const response = await api("POST", "/v1/profiles/section", {
            name: groupSection, revision: section.revision, content: updated,
        });
        if (response?.error || response?.file !== section.file || typeof response.revision !== "string") {
            throw new Error("写入失败，配置可能已更新，请重新刷新");
        }
    }

    if (restored.length) lines.push("已恢复：" + restored.map(item => item.name).join("、"));
    lines.push("已排除 " + excluded.length + " 个候选节点");
    return {title, content: lines.join("\n"), style: excluded.length || unknown.length ? "alert" : "good"};
}

if (typeof $trigger === "undefined" || $trigger !== "button" ||
    typeof $input === "undefined" || $input?.purpose !== "panel") {
    $done({title, content: "点击刷新，检查 Proxy 节点并排除送中出口。", style: "info"});
} else {
    refresh().then(
        panel => $done(panel),
        error => $done({title, content: error.message || "检测失败，请重新刷新", style: "error"}),
    );
}
