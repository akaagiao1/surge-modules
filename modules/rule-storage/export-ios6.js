// Read-only export: use as script_text for POST /v1/scripting/evaluate.
// With Surge iOS 6, use the native "Call HTTP API" Shortcuts action.
const rows = {};
for (const region of ['china', 'global']) {
  const raw = $persistentStore.read(`Rule-Storage-${region}`) || '';
  rows[region] = [...new Set(raw.split(/\r?\n/).map(line => {
    const rule = line.split(/\/\/|#|;/, 1)[0].trim();
    const match = rule.match(/^(?:(DOMAIN(?:-SUFFIX)?),\s*)?(\.?[\p{L}\p{M}\p{N}.-]+)$/iu);
    if (!match) return '';
    const bare = match[2].replace(/^\./, '').replace(/\.$/, '').toLowerCase();
    if (!bare.includes('.') || bare.split('.').some(label => !label || label.length > 63 || /^-|-$/.test(label))) return '';
    const type = match[1]?.toUpperCase() || (match[2].startsWith('.') ? 'DOMAIN-SUFFIX' : 'DOMAIN');
    return `${type},${bare}`;
  }).filter(Boolean))].join('\n');
}
$done(rows);
