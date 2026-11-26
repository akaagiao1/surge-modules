/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Adapted from NobyDa's Rule-Storage.js (10d1426d9d60edb37e24451b28811b163efc8e43).
 * https://nobyda.github.io/2024/02/24/Surge_Rule_Storage/
 * Modified for surge-modules on 2026-11-26. See LICENSE for license terms.
 */

const DAY = 86400000;
const DEFAULT_WHITELIST = ['.mwcname.com', '.akadns.', '.akamai.', '.cloud.', '.cdn.', '.yun.'];

run();

async function run() {
  let matched = false;
  try {
    const args = parseArguments(typeof $argument === 'string' ? $argument : '');
    matched = enabled(args.matched);
    const key = args.key || 'Rule-Storage';
    let region = args.region || 'debug';
    const addresses = $request.dnsResult?.v4Addresses || [];
    if (addresses.includes('127.0.0.1') || addresses.includes('0.0.0.0')) {
      matched = false;
      region = 'global';
    }

    const host = ($request.hostname || '').trim().toLowerCase().replace(/\.$/, '');
    const benchmark = $request.listenPort === 6152 && !$request.sourcePort &&
      !$request.processPath && /^[a-z0-9]{10}\.[a-z]+$/.test(host);
    if (!host.includes('.') || /\d$|[:\s,\/]/.test(host) || benchmark) return;

    const exportKey = `${key}-${region}`;
    const countKey = `${key}-counts-${region}`;
    const exact = enabled(args.exact);
    const currentRules = readRules(exportKey);
    if (hasRule(currentRules, host, exact)) return;

    // Import old counts once, without changing the keys read by existing Shortcuts.
    const storedCounts = readJSON(countKey);
    const counts = storedCounts ?? readJSON(key)?.[region] ?? {};
    const quantity = positiveInteger(args.quantity, 10);
    const interval = nonnegativeInteger(args.interval, 30) * 1000;
    const now = Date.now();
    const entry = counts[host];
    const shouldCount = !entry || now - entry.update_time >= interval;
    if (shouldCount) {
      const maxAge = positiveInteger(args.cacheDays, 30) * DAY;
      const previous = entry && now - entry.update_time <= maxAge ? entry.quantity : 0;
      counts[host] = { quantity: previous + 1, update_time: now };
      trimCounts(counts, now - maxAge, positiveInteger(args.cacheNumber, 1000));
    }
    if ((shouldCount || !storedCounts) && !saveJSON(countKey, counts)) return;
    if (counts[host].quantity < quantity) return;

    const whitelist = parseList(args.whitelist) || DEFAULT_WHITELIST;
    const keepHost = exact || matchesWhitelist(host, whitelist) || /[^a-z0-9.-]|(^|\.)xn--/.test(host);
    const suffix = keepHost ? null : registrableDomain(host, await loadSuffixList(`${key}-eTLD`));

    // Re-read both stores after the download. Another request may have updated them.
    const latestCounts = readJSON(countKey) || {};
    if (!latestCounts[host]) return;
    const latestRules = readRules(exportKey);
    if (!hasRule(latestRules, host, exact)) {
      const rule = suffix ? `DOMAIN-SUFFIX,${suffix}` : `DOMAIN,${host}`;
      if (!$persistentStore.write([...latestRules, rule].join('\n'), exportKey)) return;
    }
    delete latestCounts[host];
    saveJSON(countKey, latestCounts);
  } catch (error) {
    console.log(`[Rule-Storage] ${error.message || error}`);
  } finally {
    $done({ matched });
  }
}

function trimCounts(counts, cutoff, limit) {
  for (const host of Object.keys(counts)) {
    if (counts[host].update_time < cutoff) delete counts[host];
  }
  const hosts = Object.keys(counts);
  if (hosts.length <= limit) return;
  hosts.sort((a, b) => counts[a].update_time - counts[b].update_time);
  for (const host of hosts.slice(0, hosts.length - limit)) delete counts[host];
}

function readRules(key) {
  return ($persistentStore.read(key) || '').split(/\r?\n/).map(line => {
    const value = line.split(/\/\/|#|;/, 1)[0].trim();
    if (!value || value.includes(',')) return value;
    return value.startsWith('.') ? `DOMAIN-SUFFIX,${value.slice(1)}` : `DOMAIN,${value}`;
  }).filter(Boolean);
}

function hasRule(rules, host, exact) {
  return rules.some(rule => {
    const [type, domain] = rule.split(',');
    return type === 'DOMAIN' ? host === domain : !exact && type === 'DOMAIN-SUFFIX' &&
      (host === domain || host.endsWith(`.${domain}`));
  });
}

function matchesWhitelist(host, whitelist) {
  return whitelist.some(value => {
    if (!value.startsWith('.')) return host === value;
    if (value.endsWith('.')) return host.includes(value.slice(1, -1));
    return host === value.slice(1) || host.endsWith(value);
  });
}

async function loadSuffixList(cacheKey) {
  const cache = readJSON(cacheKey);
  // The old parser removed wildcard and exception markers, so refresh that cache.
  const saved = cache?.version === 2 && Array.isArray(cache.public_suffix) ? cache.public_suffix : [];
  const now = Date.now();
  if ((saved.length && now - cache.update_time < 30 * DAY) || now < cache?.retryAt) return saved;

  const body = await new Promise(resolve => {
    $httpClient.get({ url: 'https://publicsuffix.org/list/public_suffix_list.dat', timeout: 2 },
      (error, response, data) => resolve(!error && response?.status === 200 && typeof data === 'string' ? data : ''));
  });
  const rules = body.split('\n').map(line => line.split('//', 1)[0].trim().toLowerCase())
    .filter(line => /^(?:!|\*\.)?[\p{L}\p{M}\p{N}.-]+$/u.test(line));
  if (rules.length && rules.includes('com')) {
    saveJSON(cacheKey, { version: 2, update_time: now, public_suffix: rules });
    return rules;
  }

  const latest = readJSON(cacheKey);
  if (latest?.version === 2 && latest.update_time >= now) return latest.public_suffix;
  saveJSON(cacheKey, { version: 2, update_time: cache?.update_time || 0,
    public_suffix: saved, retryAt: now + 300000 });
  return saved;
}

function registrableDomain(host, rules) {
  const labels = host.split('.');
  const suffixes = new Set(rules);
  let publicLabels = 0;
  for (let i = labels.length - 1; i >= 0; i--) {
    const suffix = labels.slice(i).join('.');
    if (suffixes.has(`!${suffix}`)) {
      publicLabels = labels.length - i - 1;
      break;
    }
    const wildcard = `*.${labels.slice(i + 1).join('.')}`;
    if (suffixes.has(suffix) || suffixes.has(wildcard)) publicLabels = labels.length - i;
  }
  if (!publicLabels || labels.length <= publicLabels + 1) return null;
  return labels.slice(-publicLabels - 1).join('.');
}

function parseArguments(argument) {
  const args = Object.create(null);
  for (const param of argument.split('&')) {
    const index = param.indexOf('=');
    if (index > 0) args[param.slice(0, index)] = decodeURIComponent(param.slice(index + 1));
  }
  return args;
}

function enabled(value) {
  return value === '1' || value?.toLowerCase() === 'true';
}

function nonnegativeInteger(value, fallback) {
  const number = Number(value);
  return value && Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  return nonnegativeInteger(value, fallback) || fallback;
}

function parseList(value) {
  const list = parseJSON(value);
  return Array.isArray(list) && list.every(entry => typeof entry === 'string' && entry.trim()) ?
    list.map(entry => entry.trim().toLowerCase()) : null;
}

function parseJSON(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function readJSON(key) {
  return parseJSON($persistentStore.read(key));
}

function saveJSON(key, value) {
  const saved = $persistentStore.write(JSON.stringify(value), key);
  if (!saved) console.log(`[Rule-Storage] Unable to write ${key}`);
  return saved;
}
