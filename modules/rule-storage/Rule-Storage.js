/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Adapted from NobyDa's Rule-Storage.js (10d1426d9d60edb37e24451b28811b163efc8e43).
 * https://nobyda.github.io/2024/02/24/Surge_Rule_Storage/
 * Modified for surge-modules on 2026-11-26. See LICENSE for license terms.
 */

const DAY = 86400000;
const DEFAULT_WHITELIST = ['.mwcname.com', '.akadns.', '.akamai.', '.cloud.', '.cdn.', '.yun.'];
const PSL_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const PSL_MARKERS = ['// ===BEGIN ICANN DOMAINS===', '// ===END ICANN DOMAINS===',
  '// ===BEGIN PRIVATE DOMAINS===', '// ===END PRIVATE DOMAINS==='];

main();

function main() {
  const args = parseArguments(typeof $argument === 'string' ? $argument : '');
  const key = args.key || 'Rule-Storage';
  if (typeof $request === 'undefined') {
    if (args.action === 'refresh-psl') {
      refreshSuffixList(`${key}-eTLD`).catch(logError).finally(() => $done());
    } else {
      $done();
    }
    return;
  }

  let matched = enabled(args.matched);
  let region = args.region || 'debug';
  try {
    const addresses = $request.dnsResult?.v4Addresses || [];
    if (addresses.includes('127.0.0.1') || addresses.includes('0.0.0.0')) {
      matched = false;
      region = 'global';
    }
    collect(args, key, region);
  } catch (error) {
    logError(error);
  } finally {
    $done({ matched });
  }
}

function collect(args, key, region) {
  const host = normalizeHost($request.hostname);
  if (!host) return;
  if ($request.listenPort === 6152 && !$request.sourcePort && !$request.processPath &&
      /^[a-z0-9]{10}\.[a-z]+$/.test(host)) return;

  const exportKey = `${key}-${region}`;
  const countKey = `${key}-counts-${region}`;
  const exact = enabled(args.exact);
  const snapshot = $persistentStore.read(exportKey) || '';
  if (hasRule(snapshot, host, exact)) return;

  // Read legacy counts only until this region has its own store.
  const stored = readJSON(countKey);
  const source = record(stored) || record(readJSON(key)?.[region]);
  const counts = Object.assign(Object.create(null), source);
  const now = Date.now();
  const maxAge = positiveInteger(args.cacheDays, 30) * DAY;
  const interval = nonnegativeInteger(args.interval, 30) * 1000;
  const quantity = positiveInteger(args.quantity, 10);
  const entry = counts[host];
  const fresh = validEntry(entry) && now - entry.update_time <= maxAge;
  if (!fresh || now - entry.update_time >= interval) {
    counts[host] = { quantity: fresh ? Math.min(quantity, entry.quantity + 1) : 1, update_time: now };
    trimCounts(counts, now - maxAge, positiveInteger(args.cacheNumber, 1000), host);
    if (!saveJSON(countKey, counts)) return;
  } else if (!record(stored) && !saveJSON(countKey, counts)) {
    return;
  }
  if (counts[host].quantity < quantity) return;

  const whitelist = parseList(args.whitelist) || DEFAULT_WHITELIST;
  const keepHost = exact || matchesWhitelist(host, whitelist) || /[^a-z0-9.-]|(^|\.)xn--/.test(host);
  const suffix = keepHost ? null : registrableDomain(host, cachedRules(readJSON(`${key}-eTLD`)));
  const rule = suffix ? `DOMAIN-SUFFIX,${suffix}` : `DOMAIN,${host}`;

  const latest = $persistentStore.read(exportKey) || '';
  if (!hasRule(latest, host, exact)) {
    // Convert old bare entries to RULE-SET syntax; keep comments and custom lines.
    const text = normalizeLegacyRules(latest);
    const joiner = text && !text.endsWith('\n') ? '\n' : '';
    if (!save(`${text}${joiner}${rule}`, exportKey)) return;
  }
  const currentCounts = record(readJSON(countKey));
  if (currentCounts?.[host]?.quantity >= quantity) {
    delete currentCounts[host];
    saveJSON(countKey, currentCounts);
  }
}

function normalizeHost(value) {
  if (typeof value !== 'string') return '';
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || /^\d+$/.test(labels[labels.length - 1]) ||
      !labels.every(label => label.length <= 63 && /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u.test(label))) return '';
  if (host === 'localhost.localdomain' || /\.(?:localhost|local|home\.arpa)$/.test(host)) return '';
  return host;
}

function validEntry(entry) {
  return !!entry && Number.isSafeInteger(entry.quantity) && entry.quantity > 0 &&
    Number.isFinite(entry.update_time);
}

function trimCounts(counts, cutoff, limit, keep) {
  const candidates = [];
  for (const host of Object.keys(counts)) {
    if (host === keep) continue;
    if (!validEntry(counts[host]) || counts[host].update_time < cutoff) delete counts[host];
    else candidates.push(host);
  }
  if (candidates.length < limit) return;
  candidates.sort((a, b) => counts[a].update_time - counts[b].update_time);
  for (const host of candidates.slice(0, candidates.length + 1 - limit)) delete counts[host];
}

function normalizeLegacyRules(text) {
  return text.replace(/^(\s*)(\.?[^\s,#;/]+)(?=[ \t]*(?:\/\/|#|;|\r?$))/gm, (line, indent, bare) => {
    const domain = normalizeHost(bare.replace(/^\./, ''));
    return domain ? `${indent}${bare.startsWith('.') ? 'DOMAIN-SUFFIX' : 'DOMAIN'},${domain}` : line;
  });
}

function hasRule(text, host, exact) {
  for (const line of text.split(/\r?\n/)) {
    const value = line.split(/\/\/|#|;/, 1)[0].trim();
    if (!value) continue;
    let [type, domain] = value.split(',', 2);
    if (domain === undefined) {
      type = value.startsWith('.') ? 'DOMAIN-SUFFIX' : 'DOMAIN';
      domain = value.replace(/^\./, '');
    }
    domain = domain.trim().toLowerCase().replace(/\.$/, '');
    type = type.trim().toUpperCase();
    if (type === 'DOMAIN' && host === domain) return true;
    if (!exact && type === 'DOMAIN-SUFFIX' && (host === domain || host.endsWith(`.${domain}`))) return true;
  }
  return false;
}

function matchesWhitelist(host, whitelist) {
  return whitelist.some(value => {
    if (!value.startsWith('.')) return host === value;
    if (value.endsWith('.')) return host.includes(value.slice(1, -1));
    return host === value.slice(1) || host.endsWith(value);
  });
}

function cachedRules(cache) {
  return cache?.version === 2 && Array.isArray(cache.public_suffix) ? cache.public_suffix : [];
}

async function refreshSuffixList(cacheKey) {
  const started = Date.now();
  const cache = readJSON(cacheKey);
  if (typeof $cronexp !== 'undefined' && cachedRules(cache).length && started - cache.update_time < 7 * DAY) {
    console.log('[Rule-Storage] PSL is up to date');
    return;
  }
  const body = await new Promise((resolve, reject) => {
    $httpClient.get({ url: PSL_URL, timeout: 8 }, (error, response, data) => {
      if (error || response?.status !== 200 || typeof data !== 'string') {
        reject(new Error(`PSL download failed (HTTP ${response?.status ?? 'unavailable'}); cache unchanged`));
      } else {
        resolve(data);
      }
    });
  });
  const rules = parseSuffixList(body);
  if (!rules.length) throw new Error('Invalid or incomplete PSL; cache unchanged');
  if (readJSON(cacheKey)?.update_time > started) return;
  if (saveJSON(cacheKey, { version: 2, update_time: Date.now(), public_suffix: rules })) {
    console.log(`[Rule-Storage] PSL refreshed (${rules.length} entries)`);
  }
}

function parseSuffixList(body) {
  if (body.length > 1000000) return [];
  let marker = 0;
  const rules = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === PSL_MARKERS[marker]) { marker++; continue; }
    if (marker !== 1 && marker !== 3) continue;
    if (/^(?:!|\*\.)?[\p{L}\p{M}\p{N}.-]+$/u.test(line)) rules.add(line.toLowerCase());
  }
  return marker === PSL_MARKERS.length && rules.has('com') && rules.has('co.uk') && rules.size >= 1000 ? [...rules] : [];
}

function registrableDomain(host, rules) {
  if (!rules.length) return null;
  const labels = host.split('.');
  const suffixes = new Set(rules);
  let publicLabels = 0;
  for (let i = labels.length - 1; i >= 0; i--) {
    const suffix = labels.slice(i).join('.');
    if (suffixes.has(`!${suffix}`)) {
      publicLabels = labels.length - i - 1;
      break;
    }
    const wildcard = i < labels.length - 1 && `*.${labels.slice(i + 1).join('.')}`;
    if (suffixes.has(suffix) || (wildcard && suffixes.has(wildcard))) publicLabels = labels.length - i;
  }
  // Unknown suffixes and apex requests stay exact, even in suffix mode.
  if (!publicLabels || labels.length <= publicLabels + 1) return null;
  return labels.slice(-publicLabels - 1).join('.');
}

function parseArguments(argument) {
  const args = Object.create(null);
  for (const param of argument.split('&')) {
    const index = param.indexOf('=');
    if (index <= 0) continue;
    const name = param.slice(0, index);
    try { args[name] = decodeURIComponent(param.slice(index + 1)); }
    catch { /* Ignore only the malformed argument, preserving matched. */ }
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

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseJSON(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function readJSON(key) {
  return parseJSON($persistentStore.read(key));
}

function save(data, key) {
  const saved = $persistentStore.write(data, key);
  if (!saved) console.log(`[Rule-Storage] Unable to write ${key}`);
  return saved;
}

function saveJSON(key, value) {
  return save(JSON.stringify(value), key);
}

function logError(error) {
  console.log(`[Rule-Storage] ${error?.message || error}`);
}
