// Run: node --test tests/rule-storage.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const modulePath = join(__dirname, '../modules/rule-storage');
const script = new vm.Script(readFileSync(process.env.RULE_STORAGE_SOURCE || join(modulePath, 'Rule-Storage.js'), 'utf8'));
const start = 1800000000000;
const list = ['com', 'uk', 'co.uk', 'io', 'github.io', 'ck', '*.ck', '!www.ck'];
const cached = rules => JSON.stringify({ version: 2, update_time: start, public_suffix: rules });
const psl = ['// ===BEGIN ICANN DOMAINS===', ...list.filter(x => x !== 'github.io'),
  ...Array.from({ length: 1000 }, (_, i) => `test${i}`), '// ===END ICANN DOMAINS===',
  '// ===BEGIN PRIVATE DOMAINS===', 'github.io', '// ===END PRIVATE DOMAINS==='].join('\n');

async function execute({ store = new Map(), host = 'images.example.com', request = {}, mode = 'rule',
  args = 'region=global&quantity=1', now = start, reply, refuse } = {}) {
  let reads = 0;
  let fetch = 0;
  const logs = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  class MockDate extends Date { static now() { return now; } }
  const context = {
    Date: MockDate, $argument: args, console: { log: line => logs.push(line) },
    $persistentStore: { read(key) { reads++; return store.get(key) || null; }, write(value, key) {
      assert.equal(typeof value, 'string');
      if (refuse === key) return false;
      store.set(key, value);
      return true;
    } },
    $httpClient: { get(_, cb) { fetch++; queueMicrotask(() => cb(...(reply || [null, { status: 200 }, psl]))); } },
    $done(result) { finish(result); },
  };
  if (mode === 'rule') context.$request = { hostname: host, ...request };
  if (mode === 'cron') context.$cronexp = '0 4 * * *';
  script.runInNewContext(context, { timeout: 1000 });
  const result = await done;
  if (mode === 'rule') assert.equal(fetch, 0, 'A rule script must never download the PSL');
  return { result, store, fetch, logs, reads };
}

test('new install uses exact without waiting for a download', async () => {
  const { store, result } = await execute();
  assert.equal(result.matched, false);
  assert.equal(store.get('Rule-Storage-global'), 'DOMAIN,images.example.com');
});

test('preserves direct/matched decision even when ignoring a malformed argument or host', async () => {
  const { result, store } = await execute({ host: '127.0.0.1', args: 'region=china&bad=%Q&matched=1' });
  assert.equal(result.matched, true);
  assert.equal(store.size, 0);
});

test('preserves original blocking DNS fallback and global key', async () => {
  const { result, store } = await execute({ args: 'region=china&matched=1&quantity=1',
    request: { dnsResult: { v4Addresses: ['0.0.0.0'] } } });
  assert.equal(result.matched, false);
  assert.equal(store.get('Rule-Storage-global'), 'DOMAIN,images.example.com');
  assert.equal(store.has('Rule-Storage-china'), false);
});

test('threshold, 30 sec debounce and legacy counts migration', async () => {
  const h = 'images.example.com';
  const legacy = JSON.stringify({ china: { [h]: { quantity: 8, update_time: start - 30000 } } });
  const store = new Map([['Rule-Storage', legacy]]);
  const args = 'region=china&matched=1';
  await execute({ store, args });
  await execute({ store, args, now: start + 29999 });
  assert.equal(store.has('Rule-Storage-china'), false);
  assert.equal(JSON.parse(store.get('Rule-Storage-counts-china'))[h].quantity, 9);
  assert.equal((await execute({ store, args, now: start + 30000 })).result.matched, true);
  assert.equal(store.get('Rule-Storage-china'), `DOMAIN,${h}`);
  assert.equal(store.get('Rule-Storage'), legacy);
});

test('an expired count resets even when interval is longer than cache age', async () => {
  const store = new Map([['Rule-Storage-counts-global', JSON.stringify({ 'images.example.com': {
    quantity: 9, update_time: start - 86400001,
  } })]]);
  await execute({ store, args: 'region=global&cacheDays=1&interval=172800' });
  assert.equal(JSON.parse(store.get('Rule-Storage-counts-global'))['images.example.com'].quantity, 1);
});

test('keeps current host when count limit and timestamps tie', async () => {
  const store = new Map();
  await execute({ store, args: 'region=global&cacheNumber=1', host: 'other.example.com' });
  await execute({ store, args: 'region=global&cacheNumber=1', host: 'images.example.com' });
  assert.deepEqual(Object.keys(JSON.parse(store.get('Rule-Storage-counts-global'))), ['images.example.com']);
});

for (const [host, rule] of [
  ['api.Example.CO.UK.', 'DOMAIN-SUFFIX,example.co.uk'],
  ['api.me.github.io', 'DOMAIN-SUFFIX,me.github.io'],
  ['foo.bar.baz.ck', 'DOMAIN-SUFFIX,bar.baz.ck'],
  ['foo.www.ck', 'DOMAIN-SUFFIX,www.ck'],
  ['foo.baz.ck', 'DOMAIN,foo.baz.ck'],
  ['api.example.fake', 'DOMAIN,api.example.fake'],
  ['example.com', 'DOMAIN,example.com'],
  ['api.xn--bcher-kva.com', 'DOMAIN,api.xn--bcher-kva.com'],
  ['api.cdn.example.com', 'DOMAIN,api.cdn.example.com'],
]) test(`suffix or exact: ${host}`, async () => {
  const store = new Map([['Rule-Storage-eTLD', cached(list)]]);
  await execute({ store, host });
  assert.equal(store.get('Rule-Storage-global'), rule);
});

test('exact Muse mode preserves custom region and matched', async () => {
  const store = new Map([['Rule-Storage-eTLD', cached(list)]]);
  const { result } = await execute({ store, args: 'region=muse-ios&exact=1&quantity=1&matched=1' });
  assert.equal(result.matched, true);
  assert.equal(store.get('Rule-Storage-muse-ios'), 'DOMAIN,images.example.com');
});

test('old bare rules still match, keep comments and migrate on append', async () => {
  const source = '# generated\r\n  .Example.com  # note\r\nDOMAIN-KEYWORD,legacy';
  const store = new Map([['Rule-Storage-global', source]]);
  await execute({ store });
  assert.equal(store.get('Rule-Storage-global'), source);
  await execute({ store, host: 'assets.example.net' });
  assert.equal(store.get('Rule-Storage-global'), '# generated\r\n  DOMAIN-SUFFIX,example.com  # note\r\nDOMAIN-KEYWORD,legacy\nDOMAIN,assets.example.net');
});

test('skips non-domain hosts and local discovery names', async () => {
  for (const host of ['127.0.0.1', '::1', 'my-printer.local', 'router.home.arpa', 'foo..com', 'a-.com', 'bad,payload.com']) {
    assert.equal((await execute({ host })).store.size, 0, host);
  }
});

test('save failure leaves counts for a retry without affecting routing', async () => {
  const store = new Map();
  const args = 'region=china&matched=true&quantity=1';
  const { result } = await execute({ store, args, refuse: 'Rule-Storage-china' });
  assert.equal(result.matched, true);
  assert.equal(store.has('Rule-Storage-china'), false);
  await execute({ store, args, now: start + 1000 });
  assert.equal(store.get('Rule-Storage-china'), 'DOMAIN,images.example.com');
});

test('manual refresh caches ICANN and PRIVATE rules without writing rules', async () => {
  const { store, fetch } = await execute({ mode: 'generic', args: 'action=refresh-psl' });
  assert.equal(fetch, 1);
  assert.deepEqual([...store.keys()], ['Rule-Storage-eTLD']);
  assert.equal(JSON.parse(store.get('Rule-Storage-eTLD')).public_suffix.includes('github.io'), true);
  await execute({ store, host: 'api.me.github.io' });
  assert.equal(store.get('Rule-Storage-global'), 'DOMAIN-SUFFIX,me.github.io');
});

test('cron skips fresh cache; incomplete response or HTTP error does not overwrite it', async () => {
  const old = cached(list);
  const store = new Map([['Rule-Storage-eTLD', old]]);
  assert.equal((await execute({ store, mode: 'cron', args: 'action=refresh-psl' })).fetch, 0);
  for (const reply of [[null, { status: 200 }, psl.replace('// ===END PRIVATE DOMAINS===', '')], [null, { status: 503 }, '']]) {
    const { fetch } = await execute({ store, mode: 'cron', args: 'action=refresh-psl', now: start + 8 * 86400000, reply });
    assert.equal(fetch, 1);
    assert.equal(store.get('Rule-Storage-eTLD'), old);
  }
});

if (process.env.PSL_FIXTURE) test('current publicsuffix.org file is accepted by the parser', async () => {
  const reply = [null, { status: 200 }, readFileSync(process.env.PSL_FIXTURE, 'utf8')];
  const { store } = await execute({ mode: 'generic', args: 'action=refresh-psl', reply });
  const rules = JSON.parse(store.get('Rule-Storage-eTLD')).public_suffix;
  assert.ok(rules.length > 5000 && rules.includes('github.io'));
});

test('a legacy count already at threshold exports before the interval elapses', async () => {
  const store = new Map([['Rule-Storage', JSON.stringify({ china: {
    'images.example.com': { quantity: 10, update_time: start },
  } })]]);
  await execute({ store, args: 'region=china&matched=1&exact=1' });
  assert.equal(store.get('Rule-Storage-china'), 'DOMAIN,images.example.com');
});

test('pending background refresh never holds up either region', async () => {
  const store = new Map();
  const pending = execute({ store, mode: 'generic', args: 'action=refresh-psl' });
  await Promise.all([execute({ store }), execute({ store, args: 'region=china&quantity=1&matched=1' })]);
  assert.equal(store.get('Rule-Storage-global'), 'DOMAIN,images.example.com');
  assert.equal(store.get('Rule-Storage-china'), 'DOMAIN,images.example.com');
  await pending;
  await execute({ store, host: 'api.example.co.uk' });
  assert.equal(store.get('Rule-Storage-global'), 'DOMAIN,images.example.com\nDOMAIN-SUFFIX,example.co.uk');
});

test('iOS 6 Shortcut payload uses the read-only exporter and returns unique candidates', () => {
  const payload = JSON.parse(readFileSync(join(modulePath, 'export-ios6-body.json'), 'utf8'));
  assert.equal(payload.script_text, readFileSync(join(modulePath, 'export-ios6.js'), 'utf8'));
  assert.equal(payload.mock_type, 'cron');
  const store = { 'Rule-Storage-china': '# comment\r\n.example.cn\r\nDOMAIN-SUFFIX,example.cn\r\nAPI.EXAMPLE.CN\r\nIP-CIDR,192.0.2.0/24' };
  let result;
  vm.runInNewContext(payload.script_text, {
    $persistentStore: { read: key => store[key], write() { throw new Error('Export must not write'); } },
    $done: value => { result = JSON.parse(JSON.stringify(value)); },
  });
  assert.deepEqual(result, { china: 'DOMAIN-SUFFIX,example.cn\nDOMAIN,api.example.cn', global: '' });
});
