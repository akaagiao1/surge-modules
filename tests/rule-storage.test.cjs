const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {runInNewContext} = require('node:vm');

const source = readFileSync(process.env.RULE_STORAGE_SOURCE ||
  join(__dirname, '../modules/rule-storage/Rule-Storage.js'), 'utf8');
const suffixList = 'com\ncn\n*.ck\n!www.ck\n';

function harness() {
  const values = new Map();
  const downloads = [];
  let time = Date.now();

  function run(hostname, argument, request = {}) {
    const now = time += 1000;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Missing $done()')), 1000);
      runInNewContext(source, {
        $argument: argument,
        $request: {hostname, ...request},
        $done: result => { clearTimeout(timeout); resolve(result.matched); },
        $persistentStore: {
          read: key => values.get(key) ?? null,
          write: (value, key) => (values.set(key, value), true),
        },
        $httpClient: {get: (options, callback) => {
          downloads.push({options, respond(...args) {
            try { callback(...args); }
            catch (error) { clearTimeout(timeout); reject(error); }
          }});
        }},
        $notification: {post() {}},
        console: {log() {}},
        Date: class extends Date {static now() { return now; }},
      });
    });
  }

  return {values, downloads, run};
}

test('the script treats matched=0 as false and matched=1 as true', async () => {
  const h = harness();
  assert.equal(await h.run('www.example.com', 'region=global&matched=0'), false);
  assert.equal(await h.run('www.example.cn', 'region=china&matched=1'), true);
});

test('a cold download failure saves an exact rule and completes matching', async () => {
  const h = harness();
  const result = h.run('api.example.cn', 'region=china&matched=1&quantity=1');
  h.downloads[0].respond('network unavailable', undefined, undefined);
  assert.equal(await result, true);
  assert.equal(h.values.get('Rule-Storage-china'), 'DOMAIN,api.example.cn');
});

test('wildcard and exception suffixes retain their original meaning', async () => {
  const h = harness();
  const result = h.run('media.api.foo.ck', 'region=global&quantity=1');
  h.downloads[0].respond(null, {status: 200}, suffixList);
  await result;
  await h.run('api.www.ck', 'region=global&quantity=1');
  assert.equal(h.values.get('Rule-Storage-global'), 'DOMAIN-SUFFIX,api.foo.ck\nDOMAIN-SUFFIX,www.ck');
  assert.equal(h.downloads.length, 1);
});

test('requests can update both regions while a suffix download is pending', async () => {
  const h = harness();
  const waiting = h.run('api.slow.com', 'region=global&quantity=1');
  await h.run('api.other.com', 'region=global&quantity=2');
  await h.run('api.fast.cn', 'region=china&quantity=2');
  h.downloads[0].respond(null, {status: 200}, suffixList);
  await waiting;
  await h.run('api.other.com', 'region=global&quantity=2&interval=0', {dnsResult: {}});
  await h.run('api.fast.cn', 'region=china&quantity=2&interval=0');
  assert.equal(h.values.get('Rule-Storage-global'), 'DOMAIN-SUFFIX,slow.com\nDOMAIN-SUFFIX,other.com');
  assert.equal(h.values.get('Rule-Storage-china'), 'DOMAIN-SUFFIX,fast.cn');
});

test('concurrent exports in the same region preserve both generated rules', async () => {
  const h = harness();
  const pending = h.run('api.first.com', 'region=global&quantity=1');
  const concurrent = h.run('api.second.com', 'region=global&quantity=1&exact=1');
  h.downloads[1]?.respond(null, {status: 200}, suffixList);
  await concurrent;
  h.downloads[0].respond(null, {status: 200}, suffixList);
  await pending;
  assert.equal(h.values.get('Rule-Storage-global'), 'DOMAIN,api.second.com\nDOMAIN-SUFFIX,first.com');
});

test('exact mode collects full domains without a list download', async () => {
  const h = harness();
  const result = h.run('API.Example.COM.', 'region=myapp&quantity=1&exact=1');
  h.downloads[0]?.respond(null, {status: 200}, suffixList);
  assert.equal(await result, false);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.values.get('Rule-Storage-myapp'), 'DOMAIN,api.example.com');
  await h.run('192.0.2.8', 'region=myapp&quantity=1&exact=1');
  assert.equal(h.values.get('Rule-Storage-myapp'), 'DOMAIN,api.example.com');
});

test('existing counts migrate and new rules append to the original export key', async () => {
  const h = harness();
  h.values.set('Rule-Storage', JSON.stringify({china: {
    'api.example.cn': {quantity: 1, update_time: Date.now() - 60000},
  }}));
  h.values.set('Rule-Storage-china', 'DOMAIN,original.example.cn');
  const result = h.run('api.example.cn', 'region=china&matched=1&quantity=2&exact=1');
  h.downloads[0]?.respond(null, {status: 200}, suffixList);
  await result;
  assert.equal(h.values.get('Rule-Storage-china'), 'DOMAIN,original.example.cn\nDOMAIN,api.example.cn');
});

test('a legacy count already at the threshold can export before the interval elapses', async () => {
  const h = harness();
  h.values.set('Rule-Storage', JSON.stringify({china: {
    'api.example.cn': {quantity: 10, update_time: Date.now()},
  }}));
  await h.run('api.example.cn', 'region=china&matched=1&exact=1');
  assert.equal(h.values.get('Rule-Storage-china'), 'DOMAIN,api.example.cn');
});

test('a failed refresh uses the previous correctly parsed suffix list', async () => {
  const h = harness();
  const first = h.run('api.first.com', 'region=global&quantity=1');
  h.downloads[0].respond(null, {status: 200}, suffixList);
  await first;
  const cache = JSON.parse(h.values.get('Rule-Storage-eTLD'));
  cache.update_time = Date.now() - 31 * 24 * 60 * 60 * 1000;
  h.values.set('Rule-Storage-eTLD', JSON.stringify(cache));
  const second = h.run('api.second.com', 'region=global&quantity=1');
  h.downloads[1].respond(null, {status: 503}, 'Unavailable');
  await second;
  assert.equal(h.values.get('Rule-Storage-global'), 'DOMAIN-SUFFIX,first.com\nDOMAIN-SUFFIX,second.com');
});
