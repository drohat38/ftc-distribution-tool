// Bridge to the internal Apps Script back office: export CONFIRMED event↔partner matches
// in the EventPartnerLinks shape (keyed by EventID + PartnerID), so they can be pasted /
// imported into the private tool. Only confirmed or delivered matches are exported —
// proposals and reminders are not yet commitments.
import { allocations, partnersById, eventsById } from "./data.js";

const COLS = ["EventID", "PartnerID", "active", "confirmed_meals", "partner_name", "event_city", "event_date", "source"];

export function buildConfirmedLinks(statusMap) {
  const isConfirmed = (s) => s === "confirmed" || s === "delivered";
  const rows = [];
  for (const key of Object.keys(statusMap || {})) {
    const entry = statusMap[key];
    if (!entry || !isConfirmed(entry.status)) continue;
    const [eventId, partnerId] = key.split("::");
    const e = eventsById[eventId];
    const p = partnersById[partnerId];
    if (!e || !p) continue;
    const meals =
      entry.meals ?? allocations[eventId]?.assignments.find((a) => a.partnerId === partnerId)?.meals ?? "";
    rows.push({
      EventID: eventId,
      PartnerID: partnerId,
      active: "TRUE",
      confirmed_meals: meals,
      partner_name: p.name,
      event_city: e.city,
      event_date: e.date,
      source: p.source
    });
  }
  return rows;
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [COLS.join(","), ...rows.map((r) => COLS.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

export function download(filename, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
