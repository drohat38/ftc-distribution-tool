import { eventsById, allocations, partnersById } from "../data.js";
import { useStatus } from "../store.jsx";
import { typeLabel, typeColor, fmtInt, fmtMiles, fmtDate } from "../format.js";
import StatusControl from "./StatusControl.jsx";

// Screen 3 + 4 — event drill-down with the proposed allocation, ineligible partners
// (greyed, with the reason), and the overflow shortfall + ranked backups.
export default function EventDrilldown({ eventId, onClose }) {
  const event = eventsById[eventId];
  const a = allocations[eventId];
  const status = useStatus();
  if (!event) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>

        <div className="drawer-hd">
          <div className="ev-kind">EVENT · {event.region.toUpperCase()}</div>
          <h2>{event.city}, {event.state}</h2>
          <div className="ev-sub">{event.venue} · {event.cycle} Saturday · {fmtDate(event.date)}</div>
          <div className="ev-stats">
            <span><b>{fmtInt(event.projectedMeals)}</b> projected meals</span>
            <span><b>{fmtInt(a.totalAssigned)}</b> coverable</span>
            {event.needsRefrigeration ? <span className="chip chip-cold">❄ needs cold storage</span> : null}
          </div>
        </div>

        {a.overflow ? (
          <div className="overflow-note">
            ⚠ <b>Overflow:</b> eligible partners can cover {fmtInt(a.totalAssigned)} of {fmtInt(event.projectedMeals)} meals —
            a shortfall of <b>{fmtInt(a.shortfall)}</b>. Assign a backup below.
          </div>
        ) : null}

        <h3 className="section-h">Proposed allocation ({a.assignments.length})</h3>
        {a.assignments.length === 0 ? (
          <p className="muted">No eligible partner within range — see backups and ineligible partners below.</p>
        ) : (
          <ul className="alloc-list">
            {a.assignments.map((as) => (
              <li key={as.partnerId} className="alloc-item">
                <div className="alloc-main">
                  <span className="dot" style={{ background: typeColor(as.type) }} />
                  <div>
                    <div className="alloc-name">{as.name}</div>
                    <div className="alloc-sub">
                      {typeLabel(as.type)} · {fmtMiles(as.distance)} · assign <b>{fmtInt(as.meals)}</b> of ~{fmtInt(as.capacityMeals)} <span className="est">est</span>
                    </div>
                  </div>
                </div>
                <StatusControl eventId={eventId} partnerId={as.partnerId} />
              </li>
            ))}
          </ul>
        )}

        <h3 className="section-h">
          Backups ({a.backups.length})
          {a.overflow ? <span className="muted"> — to cover the shortfall</span> : <span className="muted"> — alternates</span>}
        </h3>
        {a.backups.length === 0 ? (
          <p className="muted">No backups within the expanded radius.</p>
        ) : (
          <ul className="alloc-list">
            {a.backups.slice(0, 8).map((b) => {
              const assigned = status.get(eventId, b.partnerId)?.manual;
              return (
                <li key={b.partnerId} className={"alloc-item" + (b.expansion ? " is-expansion" : "")}>
                  <div className="alloc-main">
                    <span className="dot" style={{ background: typeColor(b.type) }} />
                    <div>
                      <div className="alloc-name">
                        {b.name}
                        {b.expansion ? <span className="chip chip-warn" title="Outside the radius — assigning expands it">expand radius</span> : null}
                      </div>
                      <div className="alloc-sub">
                        {typeLabel(b.type)} · {fmtMiles(b.distance)} · ~{fmtInt(b.freeCapacity)} meals <span className="est">est</span> · fridge {b.hasRefrigeration ? "yes" : "no"}
                      </div>
                    </div>
                  </div>
                  {assigned ? (
                    <StatusControl eventId={eventId} partnerId={b.partnerId} />
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => status.assignBackup(eventId, b.partnerId, Math.min(a.shortfall || b.freeCapacity, b.freeCapacity))}
                    >
                      Assign
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {a.ineligible.length ? (
          <details className="inelig">
            <summary>Ineligible nearby partners ({a.ineligible.length})</summary>
            <ul className="alloc-list">
              {a.ineligible.slice(0, 12).map((p) => (
                <li key={p.partnerId} className="alloc-item alloc-grey">
                  <div className="alloc-main">
                    <span className="dot" style={{ background: "#bbb" }} />
                    <div>
                      <div className="alloc-name">{p.name}</div>
                      <div className="alloc-sub">{typeLabel(p.type)} · {fmtMiles(p.distance)}</div>
                      <div className="reasons">{p.reasons.map((r, i) => <span key={i} className="reason">{r}</span>)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </div>
  );
}
