import { events, allocations, cycleSummary, partners } from "../data.js";
import { fmtInt, fmtDate } from "../format.js";

// Screen 1 — cycle dashboard: totals, shortfall flags, and the event list.
export default function Dashboard({ onSelectEvent }) {
  const s = cycleSummary;
  const coverPct = s.totalProjected ? Math.round((s.totalAssigned / s.totalProjected) * 100) : 0;

  return (
    <div className="screen">
      <div className="cards">
        <Card label="Events this cycle" value={fmtInt(s.eventCount)} sub={`${partners.length} candidate partners`} />
        <Card label="Projected meals" value={fmtInt(s.totalProjected)} sub="estimated output" />
        <Card
          label="Coverable capacity"
          value={fmtInt(s.totalAssigned)}
          sub={`${coverPct}% of projected`}
          tone={coverPct >= 100 ? "good" : "warn"}
        />
        <Card
          label="Events short"
          value={fmtInt(s.overflowCount)}
          sub={s.totalShortfall ? `${fmtInt(s.totalShortfall)} meals uncovered` : "all covered"}
          tone={s.overflowCount ? "bad" : "good"}
        />
      </div>

      <h2 className="section-h">Events ({events.length})</h2>
      <div className="table">
        <div className="tr th">
          <div className="td">Event</div>
          <div className="td">Date</div>
          <div className="td num">Projected</div>
          <div className="td num">Coverable</div>
          <div className="td">Partners</div>
          <div className="td">Status</div>
        </div>
        {events.map((e) => {
          const a = allocations[e.id];
          return (
            <button className="tr row" key={e.id} onClick={() => onSelectEvent(e.id)}>
              <div className="td">
                <div className="ev-name">{e.city}</div>
                <div className="ev-sub">{e.venue}</div>
              </div>
              <div className="td">{fmtDate(e.date)}</div>
              <div className="td num">{fmtInt(e.projectedMeals)}</div>
              <div className="td num">{fmtInt(a.totalAssigned)}</div>
              <div className="td">
                {a.assignments.length}
                {e.needsRefrigeration ? <span className="chip chip-cold" title="Event needs cold storage">❄ cold</span> : null}
              </div>
              <div className="td">
                {a.overflow ? (
                  <span className="chip chip-bad">⚠ short {fmtInt(a.shortfall)}</span>
                ) : (
                  <span className="chip chip-good">covered</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone }) {
  return (
    <div className={"card" + (tone ? " card-" + tone : "")}>
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
      {sub ? <div className="card-sub">{sub}</div> : null}
    </div>
  );
}
