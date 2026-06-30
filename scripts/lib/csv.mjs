// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped double-quotes (""), and CRLF/LF line endings. Returns an array of objects
// keyed by the header row. Good enough for the event CSV; no dependency needed.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { endField(); endRow(); }
    else field += c;
  }
  if (field.length || row.length) { endField(); endRow(); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((x) => x !== ""))
    .map((r) => {
      const o = {};
      header.forEach((h, idx) => { o[h] = r[idx] !== undefined ? r[idx] : ""; });
      return o;
    });
}
