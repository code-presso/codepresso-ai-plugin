// Minimal INI section editor for ~/.aws files. Pure string transforms.
export function renameSection(text, from, to) {
  const lines = (text || '').split('\n');
  if (lines.some((l) => l.trim() === `[${to}]`)) return text; // never clobber
  return lines.map((l) => (l.trim() === `[${from}]` ? `[${to}]` : l)).join('\n');
}

export function hasSectionKey(text, section, key) {
  const lines = (text || '').split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start === -1) return false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) return true;
  }
  return false;
}

export function upsertSectionKV(text, section, kv) {
  const lines = (text || '').split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start === -1) {
    const block = [`[${section}]`, ...Object.entries(kv).map(([k, v]) => `${k} = ${v}`)];
    const base = text && !text.endsWith('\n') ? `${text}\n` : (text || '');
    return `${base}${base ? '\n' : ''}${block.join('\n')}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  const remaining = { ...kv };
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (m && m[1] in remaining) { lines[i] = `${m[1]} = ${remaining[m[1]]}`; delete remaining[m[1]]; }
  }
  const insert = Object.entries(remaining).map(([k, v]) => `${k} = ${v}`);
  lines.splice(end, 0, ...insert);
  return lines.join('\n');
}
