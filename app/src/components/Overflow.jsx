import { events, allocations } from "../data.js";
import { fmtInt, fmtMiles, fmtDate, typeLabel } from "../format.js";

// Screen 4 (cycle-wide) — every event whose projected meals exceed eligible capacity,
// with the shortfall and the top ranked backups. Click through to assign.
export default function Overflow({ onSelectEvent }) {
  const overflowEvents = events
    .map((e) => ({ event: e, alloc: allocations[e.id] }))
    .filter((x) => x.alloc.overflow)
    .sort((a, b) => b.alloc.shortfall - a.alloc.shortfall);

  return (
    <div className="screen">
      <h2 className="section-h">Overflow events ({overflowEvents.length})</h2>
      <p className="muted screen-intro">
        Too many meals is an operations failure if partners can't absorb them. Capacity is shared per service
        date — events on the <b>same morning</b> compete for the same partners — so an event can overflow even
        when a partner looked free in isolation. Each card shows the shortfall and the ranked backups to cover it.
      </p>

      {overflowEvents.length === 0 ? (
        <div className="empty">No overflow this cycle — every event's projected meals fit within eligible partner capacity. 🎉</div>
      ) : (
        overflowEvents.map(({ event, alloc }) => (
          <div className="overflow-card" key={event.id}>
            <div className="oc-hd">
              <div>
                <div className="ev-name">{event.city}, {event.state}</div>
                <div className="ev-sub">{event.venue} · {fmtDate(event.date)}{event.needsRefrigeration ? " · ❄ cold" : ""}</div>
              </div>
              <div className="oc-stat">
                <span className="oc-short">short {fmtInt(alloc.shortfall)}</span>
                <span className="muted">{fmtInt(alloc.totalAssigned)} / {fmtInt(event.projectedMeals)} covered</span>
              </div>
            </div>
            <div className="oc-backups">
              <div className="oc-backups-h">Top backups</div>
              {alloc.backups.slice(0, 4).map((b) => (
                <div className="oc-backup" key={b.partnerId}>
                  <span>{b.name}</span>
                  <span className="muted">
                    {typeLabel(b.type)} · {fmtMiles(b.distance)} · ~{fmtInt(b.freeCapacity)} <span className="est">est</span>
                    {b.expansion ? <span className="chip chip-warn" style={{ marginLeft: 6 }}>expand radius</span> : null}
                  </span>
                </div>
              ))}
              {alloc.backups.length === 0 ? <div className="muted">No backups within the expanded radius.</div> : null}
            </div>
            <button className="btn" onClick={() => onSelectEvent(event.id)}>Open & assign backups →</button>
          </div>
        ))
      )}
    </div>
  );
}
