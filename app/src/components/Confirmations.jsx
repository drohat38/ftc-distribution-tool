import { useMemo } from "react";
import { events, allocations, eventsById, partnersById } from "../data.js";
import { useStatus } from "../store.jsx";
import { fmtInt, fmtDate, typeLabel, STATUS_LABEL, STATUS_COLOR } from "../format.js";
import StatusControl from "./StatusControl.jsx";
import { buildConfirmedLinks, toCsv, download } from "../exportLinks.js";

// Screen 5 — confirmations. Every proposed (event, partner) pair — from the engine's
// allocation plus any backups assigned in the overflow view — with its lifecycle
// status. "Send reminder" / "Mark confirmed" are simulated (no real outreach).
export default function Confirmations({ onSelectEvent }) {
  const status = useStatus();

  // Build the pair list: allocation assignments + manually-assigned backups.
  const groups = useMemo(() => {
    const byEvent = new Map();
    const add = (eventId, partnerId, meals, manual) => {
      if (!byEvent.has(eventId)) byEvent.set(eventId, []);
      const list = byEvent.get(eventId);
      if (!list.find((x) => x.partnerId === partnerId)) list.push({ partnerId, meals, manual });
    };
    for (const e of events) {
      for (const a of allocations[e.id].assignments) add(e.id, a.partnerId, a.meals, false);
    }
    for (const key of Object.keys(status.map)) {
      const entry = status.map[key];
      if (entry && entry.manual) {
        const [eventId, partnerId] = key.split("::");
        if (eventsById[eventId] && partnersById[partnerId]) add(eventId, partnerId, entry.meals, true);
      }
    }
    return [...byEvent.entries()]
      .map(([eventId, rows]) => ({ event: eventsById[eventId], rows }))
      .filter((g) => g.event)
      .sort((a, b) => (a.event.date || "").localeCompare(b.event.date || ""));
  }, [status.map]);

  const counts = useMemo(() => {
    const c = { proposed: 0, reminded: 0, confirmed: 0, delivered: 0, total: 0 };
    for (const g of groups) for (const r of g.rows) { c[status.statusOf(g.event.id, r.partnerId)]++; c.total++; }
    return c;
  }, [groups, status.map]);

  return (
    <div className="screen">
      <h2 className="section-h">Pre-event confirmations</h2>
      <p className="muted screen-intro">
        Confirm each partner can take its assigned meals <b>before</b> the event. Reminders here are simulated —
        the demo never contacts a real organization.
      </p>

      <div className="conf-summary">
        {["proposed", "reminded", "confirmed", "delivered"].map((s) => (
          <span className="conf-pill" key={s}>
            <span className="conf-swatch" style={{ background: STATUS_COLOR[s] }} /> {STATUS_LABEL[s]}: <b>{counts[s]}</b>
          </span>
        ))}
        <span className="conf-pill">Total: <b>{counts.total}</b></span>
        <span className="conf-spacer" />
        <button
          className="btn btn-xs"
          disabled={counts.confirmed + counts.delivered === 0}
          title="Export confirmed matches in the EventPartnerLinks shape for the internal tool"
          onClick={() => {
            const rows = buildConfirmedLinks(status.map);
            if (rows.length) download("confirmed-links.csv", toCsv(rows));
          }}
        >
          ⤓ Export confirmed → internal tool ({counts.confirmed + counts.delivered})
        </button>
        <button className="btn btn-xs btn-ghost" onClick={() => status.reset()}>Reset all</button>
      </div>

      {groups.map(({ event, rows }) => (
        <div className="conf-group" key={event.id}>
          <button className="conf-ev" onClick={() => onSelectEvent(event.id)}>
            <b>{event.city}</b> · {fmtDate(event.date)} · {fmtInt(event.projectedMeals)} meals →
          </button>
          <ul className="alloc-list">
            {rows.map((r) => {
              const p = partnersById[r.partnerId];
              return (
                <li key={r.partnerId} className="alloc-item">
                  <div className="alloc-main">
                    <div>
                      <div className="alloc-name">
                        {p?.name || r.partnerId} {r.manual ? <span className="chip chip-warn">backup</span> : null}
                      </div>
                      <div className="alloc-sub">{p ? typeLabel(p.type) : ""}{r.meals ? ` · ${fmtInt(r.meals)} meals` : ""}</div>
                    </div>
                  </div>
                  <StatusControl eventId={event.id} partnerId={r.partnerId} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
