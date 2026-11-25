(function () {
  'use strict';

  const api = 'https://api.themoviedb.org/3';
  const site = 'https://www.themoviedb.org';
  const panelTitle = 'TMDB 排期';
  const beijingDayEndOffset = 16 * 60 * 60 * 1000;
  const isPositiveInteger = value => Number.isSafeInteger(value) && value > 0;
  const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');

  function parseItem(line) {
    const input = line.normalize('NFKC').trim();
    const seasonMatch = /^(.*?)\s*S(\d{1,2})\s*E\s*(\d{1,4})$/i.exec(input) || /^(.*?)\s+S(\d{1,2})$/i.exec(input);
    const watchedMatch = seasonMatch ? null : /^(.*?)\s*(?:第\s*(\d{1,4})\s*[集话話]|:\s*(\d{1,4}))$/.exec(input);
    const explicitId = /^(?:tmdb|bgm|tvmaze):\d+$/i.test(input);
    const watched = seasonMatch || (explicitId ? null : watchedMatch);
    const titleWithYear = (watched ? watched[1] : input).trim().replace(/^《(.+)》$/, '$1');
    const yearMatch = /^(.*?)\s*\((\d{4})(?:年)?\)$/.exec(titleWithYear);
    const title = (yearMatch ? yearMatch[1] : titleWithYear).trim();
    const idMatch = /^tmdb:(\d{1,10})$/i.exec(title);
    const season = seasonMatch ? Number(seasonMatch[2]) : null;
    if (!title || title.length > 120 || season === 0 || (idMatch && !isPositiveInteger(Number(idMatch[1])))) {
      throw new Error('请填写有效剧名、TMDB ID 或季度编号。');
    }
    return {title, year: yearMatch ? yearMatch[2] : '', id: idMatch ? Number(idMatch[1]) : null, season,
      watched: seasonMatch ? (seasonMatch[3] ? Number(seasonMatch[3]) : null) : watched ? Number(watched[2] || watched[3]) : null};
  }

  function tmdbGet(path, token) {
    return new Promise((resolve, reject) => {
      const url = api + path + (path.includes('?') ? '&' : '?') + 'language=zh-CN';
      $httpClient.get({url, headers: {Accept: 'application/json', Authorization: 'Bearer ' + token},
        timeout: 8, 'auto-cookie': false, 'auto-redirect': false}, (err, response, data) => {
        const status = Number(response && response.status);
        if (err || status !== 200) {
          const message = err ? '连接失败或超时' : status === 401 || status === 403 ? '请检查 TMDB_TOKEN' :
            status === 429 ? '请求过多，稍后再试' : 'HTTP ' + (status || '无响应');
          reject(new Error('TMDB ' + message));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (_) { reject(new Error('TMDB 返回格式异常')); }
      });
    });
  }

  async function resolveId(item, request) {
    if (item.id) return item.id;
    const year = item.year ? '&first_air_date_year=' + item.year : '';
    const payload = await request('/search/tv?query=' + encodeURIComponent(item.title) + year);
    if (!payload || !Array.isArray(payload.results)) throw new Error('TMDB 搜索响应异常');
    const title = normalize(item.title);
    const matches = new Map();
    payload.results.forEach(show => {
      if (!show || !isPositiveInteger(show.id)) return;
      if (normalize(show.name) !== title && normalize(show.original_name) !== title) return;
      if (item.year && String(show.first_air_date || '').slice(0, 4) !== item.year) return;
      matches.set(show.id, show);
    });
    if (matches.size > 1) {
      const suggestions = Array.from(matches.values()).slice(0, 3).map(show =>
        `${show.name || show.original_name}（${String(show.first_air_date || '').slice(0, 4) || '年份未知'}） · tmdb:${show.id}`);
      throw new Error('TMDB 有同名版本，请加首播年份或填写 ID。\n' + suggestions.join('\n'));
    }
    if (!matches.size) throw new Error('TMDB 未找到精确匹配，可填写 tmdb:剧集ID');
    return matches.keys().next().value;
  }

  function episodeDate(row) {
    if (!row || !isPositiveInteger(row.season_number) || !isPositiveInteger(row.episode_number) ||
        typeof row.air_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.air_date)) return null;
    const start = Date.parse(row.air_date + 'T00:00:00Z');
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== row.air_date) return null;
    return {season: row.season_number, number: row.episode_number, date: row.air_date, at: start + beijingDayEndOffset};
  }

  const compareEpisode = (a, b) => a.season - b.season || a.number - b.number;
  const tag = ({season, number}) => 'S' + String(season).padStart(2, '0') + 'E' + String(number).padStart(2, '0');

  async function getSeasonRows(id, number, request) {
    const season = await request('/tv/' + id + '/season/' + number);
    if (!season || season.season_number !== number || !Array.isArray(season.episodes)) {
      throw new Error('TMDB 季度响应异常');
    }
    return season.episodes.filter(row => row && row.season_number === number);
  }

  async function getSchedule(item, request) {
    const id = await resolveId(item, request);
    const details = await request('/tv/' + id);
    if (!details || details.id !== id) throw new Error('TMDB 剧集响应异常');
    const title = details.name || details.original_name || item.title;
    const now = Date.now();
    let rows = [details.last_episode_to_air, details.next_episode_to_air];
    if (item.season) {
      rows = await getSeasonRows(id, item.season, request);
    } else {
      const last = episodeDate(details.last_episode_to_air);
      if (last && last.at > now) {
        // TMDB can advance its latest episode before our Beijing date cutoff.
        const priorSeason = last.number > 1 ? last.season : last.season - 1;
        if (priorSeason) rows = rows.concat(await getSeasonRows(id, priorSeason, request));
      }
    }
    const dates = rows.map(episodeDate).filter(Boolean);
    const latest = dates.filter(row => row.at <= now).sort((a, b) => compareEpisode(b, a))[0];
    const next = dates.filter(row => row.at > now).sort((a, b) => a.at - b.at || compareEpisode(a, b))[0];
    return {id, title, latest, next};
  }

  function notifyIfNew(item, schedule) {
    const {id, title, latest, next} = schedule;
    if (!latest && !next) return;
    const key = 'episode_watch_tmdb_v1_' + id + '_' + (item.season || 'all');
    const value = $persistentStore.read(key);
    const previous = value ? JSON.parse(value) : null;
    const current = latest || {season: 0, number: 0};
    if (previous && compareEpisode(current, previous) <= 0) return;

    const progress = JSON.stringify({season: current.season, number: current.number});
    if (!$persistentStore.write(progress, key)) throw new Error('无法保存 TMDB 提醒进度');
    if (!latest || !previous) return;
    const watchedSeason = item.season || previous.season || 1;
    if (item.watched !== null && latest.season === watchedSeason && latest.number <= item.watched) return;
    try {
      $notification.post('TMDB 播出提醒', title, `${tag(latest)} · TMDB 播出日期 ${latest.date}`,
        {action: 'open-url', url: `${site}/tv/${id}/season/${latest.season}/episode/${latest.number}`});
    } catch (err) {
      $persistentStore.write(value, key);
      throw err;
    }
  }

  function panel(content) {
    return {title: panelTitle, content, icon: 'calendar'};
  }

  async function main(parts) {
    const [mode, token, notifications, tmdbList, sharedList] = parts;
    if (mode === 'cron' && notifications !== 'true') return;
    if (!token || token === '-') return panel('填写模块参数 TMDB_TOKEN 以启用排期。');
    if (!/^[A-Za-z0-9_.=-]+$/.test(token)) return panel('TMDB_TOKEN 格式无效，请填写 Read Access Token。');
    const list = tmdbList && tmdbList !== '-' ? tmdbList : sharedList;
    const rows = (list || '').split(/[;；\r\n]+/).map(row => row.trim()).filter(row => row && row !== '-');
    if (rows.length > 5) return panel('剧单最多填写 5 部。');
    if (!rows.length) return panel('填写 WATCHLIST 或 TMDB_WATCHLIST 即可查询排期。');

    const requests = new Map();
    function request(path) {
      if (!requests.has(path)) requests.set(path, tmdbGet(path, token));
      return requests.get(path);
    }
    const results = await Promise.all(rows.map(async row => {
      try {
        const item = parseItem(row);
        if (/^(?:bgm|tvmaze):/i.test(item.title)) return null;
        const schedule = await getSchedule(item, request);
        if (mode === 'cron') {
          notifyIfNew(item, schedule);
          return null;
        }
        const lines = [schedule.title];
        if (item.watched !== null) lines.push('已看到 ' + (item.season ? tag({season: item.season, number: item.watched}) : `第 ${item.watched} 集`));
        lines.push(schedule.latest ? '最新已播 ' + tag(schedule.latest) : '暂无可确认的已播集');
        if (schedule.next) lines.push(`预计 ${tag(schedule.next)} · ${schedule.next.date}`);
        return lines.join('\n');
      } catch (err) {
        if (mode === 'cron') {
          console.log('TMDB 排期：' + err.message);
          return null;
        }
        return row + '\n' + err.message;
      }
    }));
    const content = results.filter(Boolean).join('\n\n');
    return panel(content ? content + '\n\n来源 TMDB · 播出日期按北京时间当日结束计算' : '请在 TMDB_WATCHLIST 填写剧名或 tmdb:剧集ID。');
  }

  const parts = (typeof $argument === 'string' ? $argument : 'panel|-|false|-|-').split('|').map(part => part.trim());
  if (parts.length !== 5) { $done(panel('剧单不能包含竖线。')); return; }
  main(parts).then(output => {
    if (parts[0] === 'cron') $done();
    else $done(output);
  }, () => {
    if (parts[0] === 'cron') $done();
    else $done(panel('查询失败，请稍后重试。'));
  });
}());
