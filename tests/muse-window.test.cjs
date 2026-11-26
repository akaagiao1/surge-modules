const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {runInNewContext} = require('node:vm');

const directory = join(__dirname, '../modules/muse-us-ios');
const source = readFileSync(process.env.MUSE_WINDOW_SOURCE || join(directory, 'Muse-Window.js'), 'utf8');

function harness() {
  const storage = new Map();
  let now = 1000;

  function run(argument) {
    const results = [];
    runInNewContext(source, {
      $argument: argument,
      $persistentStore: {
        read: key => storage.get(key) ?? null,
        write(value, key) {
          if (value === null) storage.delete(key);
          else storage.set(key, value);
          return true;
        },
      },
      $done: result => results.push(result),
      Date: class extends Date { static now() { return now; } },
    });
    assert.equal(results.length, 1);
    return results[0]?.matched;
  }

  return {storage, run, advance: milliseconds => { now += milliseconds; }};
}

test('open activates classification and close resets it across script runs', () => {
  const h = harness();
  assert.equal(h.run('match'), false);
  h.run('open');
  assert.equal(h.run('match'), true);
  h.run('close');
  assert.equal(h.run('match'), false);
});

test('the window expires after 15 minutes even without a close event', () => {
  const h = harness();
  h.run('open');
  h.advance(15 * 60 * 1000 - 1);
  assert.equal(h.run('match'), true);
  h.advance(1);
  assert.equal(h.run('match'), false);
});

test('an invalid expiry fails closed', () => {
  const h = harness();
  h.storage.set('Muse-US-Until', 'Infinity');
  assert.equal(h.run('match'), false);
});

test('the iOS module exposes the two Shortcuts scripts and leaves rule placement to the profile', () => {
  const config = readFileSync(join(directory, 'muse-us-ios.sgmodule'), 'utf8');
  assert.match(config, /^#!system=ios$/m);
  assert.doesNotMatch(config, /^\[Rule\]$/m);
  for (const [name, type, command] of [
    ['Muse-US-On', 'generic', 'open'],
    ['Muse-US-Off', 'generic', 'close'],
    ['Muse-US-Active', 'rule', 'match'],
  ]) {
    const declaration = config.split(/\r?\n/).find(line => line.startsWith(`${name} =`));
    assert.ok(declaration, name);
    assert.ok(declaration.includes(`type=${type}`));
    assert.ok(declaration.includes(`/muse-us-ios/Muse-Window.js, argument=${command}`));
  }
  assert.match(config, /^Save-Muse-iOS = type=rule, .*argument=region=muse-ios&exact=1&quantity=1&matched=1$/m);
});
