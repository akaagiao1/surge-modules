const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {runInNewContext} = require('node:vm');

const source = readFileSync(join(__dirname, '../modules/episode-watch/episode-watch-tmdb.js'), 'utf8');
const moduleConfig = readFileSync(join(__dirname, '../modules/episode-watch/episode-watch.sgmodule'), 'utf8');
const token = 'mock.read.token';
const show = {id: 1396, name: '绝命毒师', original_name: 'Breaking Bad', first_air_date: '2008-01-20'};
const now = '2026-11-25T16:00:00Z';
const episode = (season_number, episode_number, air_date) => ({season_number, episode_number, air_date});

function harness() {
  const requests = [];
  const alerts = [];
  const values = new Map();

  function run(argument, responses = {}, time = now) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Missing $done()')), 1000);
      runInNewContext(source, {
        $argument: argument,
        $done: (panel) => { clearTimeout(timeout); resolve(panel); },
        $persistentStore: {
          read: key => values.get(key) ?? null,
          write: (value, key) => (values.set(key, value), true),
        },
        $notification: {post: (...args) => alerts.push(args)},
        $httpClient: {get: (options, callback) => {
          const url = new URL(options.url);
          requests.push(options);
          const response = responses[url.pathname];
          callback(null, {status: response ? 200 : 404}, JSON.stringify(response));
        }},
        console: {log() {}},
        Date: class extends Date {static now() {return Date.parse(time);}},
      });
    });
  }
  return {run, requests, alerts};
}

test('default panel works with no token and cron makes no requests when off', async () => {
  const h = harness();
  const panel = await h.run('panel|-|false|-|Breaking Bad');
  assert.match(panel.content, /TMDB_TOKEN/);
  await h.run(`cron|${token}|false|-|Breaking Bad`);
  assert.equal(h.requests.length, 0);
});

test('the module passes the TMDB credential only to the TMDB script', async () => {
  const h = harness();
  const scripts = moduleConfig.split('[Script]')[1].trim().split(/\r?\n/);
  const upstream = scripts.filter(line => line.includes('zhiaon/Modules'));
  assert.equal(upstream.length, 2);
  assert.ok(upstream.every(line => !line.includes('TMDB_TOKEN')));
  const panel = scripts.find(line => line.startsWith('episode-watch-tmdb ='));
  const template = /argument="([^"]+)"/.exec(panel)[1];
  const values = {TMDB_TOKEN: token, TMDB_NOTIFY: 'false', TMDB_WATCHLIST: 'tmdb:1396', WATCHLIST: '-'};
  const config = template.replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => values[key]);
  const result = await h.run(config, {'/3/tv/1396': show});
  assert.match(result.content, /绝命毒师/);
  assert.equal(h.requests.length, 1);
});

test('an exact original name is matched and the premiere date ends at midnight in Beijing', async () => {
  const h = harness();
  const panel = await h.run(`panel|${token}|false|-|Breaking Bad`, {
    '/3/search/tv': {results: [{...show, id: 42, original_name: 'Breaking Badness'}, show]},
    '/3/tv/1396': {...show, last_episode_to_air: episode(2, 3, '2026-11-24'),
      next_episode_to_air: episode(2, 4, '2026-11-25')},
  }, '2026-11-25T15:59:59Z');
  assert.match(panel.content, /最新已播 S02E03/);
  assert.match(panel.content, /预计 S02E04 · 2026-11-25/);
  assert.deepEqual(h.requests.map(x => new URL(x.url).pathname), ['/3/search/tv', '/3/tv/1396']);
  assert.equal(h.requests[0].headers.Authorization, `Bearer ${token}`);
  assert.ok(h.requests.every(request => !request.url.includes(token)));
});

test('same-name candidates require a year or ID', async () => {
  const h = harness();
  const responses = {'/3/search/tv': {results: [show, {...show, id: 1234, first_air_date: '2020-01-01'}]},
    '/3/tv/1396': {...show, last_episode_to_air: episode(1, 1, '2026-11-24')}};
  const ambiguous = await h.run(`panel|${token}|false|-|Breaking Bad`, responses);
  assert.match(ambiguous.content, /同名/);
  assert.match(ambiguous.content, /tmdb:1234/);
  assert.equal(h.requests.length, 1);
  const qualified = await h.run(`panel|${token}|false|-|Breaking Bad（2008年）`, responses);
  assert.match(qualified.content, /最新已播 S01E01/);
});

test('an explicit TMDB list can track a single season without modifying the platform list', async () => {
  const h = harness();
  const panel = await h.run(`panel|${token}|false|tmdb:1396 S02E03|bgm:42`, {
    '/3/tv/1396': show,
    '/3/tv/1396/season/2': {season_number: 2,
      episodes: [episode(2, 3, '2026-11-24'), episode(2, 4, '2026-11-25'), episode(2, 5, '2026-11-26')]},
  });
  assert.match(panel.content, /已看到 S02E03/);
  assert.match(panel.content, /最新已播 S02E04/);
  assert.match(panel.content, /预计 S02E05 · 2026-11-26/);
  assert.equal(h.requests.length, 2);
});

test('the shared list accepts the original compact season and watched-episode syntax', async () => {
  const h = harness();
  const panel = await h.run(`panel|${token}|false|-|Breaking BadS02E03`, {
    '/3/search/tv': {results: [show]},
    '/3/tv/1396': show,
    '/3/tv/1396/season/2': {season_number: 2, episodes: [episode(2, 4, '2026-11-24')]},
  });
  assert.match(panel.content, /已看到 S02E03/);
  assert.match(panel.content, /最新已播 S02E04/);
});

test('automatic tracking keeps the prior aired episode when TMDB rolls over before Beijing midnight', async () => {
  const h = harness();
  const panel = await h.run(`panel|${token}|false|tmdb:1396|-`, {
    '/3/tv/1396': {...show, last_episode_to_air: episode(2, 1, '2026-11-25'),
      next_episode_to_air: episode(2, 2, '2026-11-26')},
    '/3/tv/1396/season/1': {season_number: 1, episodes: [episode(1, 8, '2026-11-24')]},
  }, '2026-11-25T15:59:59Z');
  assert.match(panel.content, /最新已播 S01E08/);
  assert.match(panel.content, /预计 S02E01 · 2026-11-25/);
});

test('the notification cron establishes a silent baseline and reports a scheduled episode only once', async () => {
  const h = harness();
  const responses = {'/3/tv/1396': {...show, last_episode_to_air: episode(1, 3, '2026-11-24'),
    next_episode_to_air: episode(1, 4, '2026-11-25')}};
  await h.run(`cron|${token}|true|tmdb:1396|-`, responses, '2026-11-25T15:30:00Z');
  await h.run(`panel|${token}|true|tmdb:1396|-`, responses);
  assert.equal(h.alerts.length, 0);
  await h.run(`cron|${token}|true|tmdb:1396|-`, responses);
  await h.run(`cron|${token}|true|tmdb:1396|-`, responses);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0][0], /TMDB/);
  assert.match(h.alerts[0][2], /S01E04/);
  assert.equal(h.alerts[0][3].url, 'https://www.themoviedb.org/tv/1396/season/1/episode/4');
});

test('a future premiere establishes a silent baseline before its first episode airs', async () => {
  const h = harness();
  const responses = {'/3/tv/1396': {...show, next_episode_to_air: episode(1, 1, '2026-11-25')}};
  await h.run(`cron|${token}|true|tmdb:1396|-`, responses, '2026-11-25T15:30:00Z');
  assert.equal(h.alerts.length, 0);
  await h.run(`cron|${token}|true|tmdb:1396|-`, responses);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0][2], /S01E01/);
});
