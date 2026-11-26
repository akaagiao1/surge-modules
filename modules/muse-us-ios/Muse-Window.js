const key = 'Muse-US-Until';
const command = typeof $argument === 'string' ? $argument : '';

if (command === 'match') {
  const until = Number($persistentStore.read(key));
  $done({ matched: Number.isFinite(until) && Date.now() < until });
} else {
  if (command === 'open') {
    $persistentStore.write(String(Date.now() + 15 * 60 * 1000), key);
  } else if (command === 'close') {
    $persistentStore.write(null, key);
  }
  $done();
}
