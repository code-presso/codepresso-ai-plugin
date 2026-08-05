/**
 * Local-timezone date helpers.
 * `new Date().toISOString().slice(0, 10)` yields the UTC date, which is
 * yesterday between 00:00 and 09:00 KST — always format in local time.
 */

/** Format a Date as YYYY-MM-DD in the local timezone. */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
