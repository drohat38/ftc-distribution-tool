import { useStatus } from "../store.jsx";
import { STATUS_LABEL, STATUS_COLOR } from "../format.js";

// Status chip + the next lifecycle action: proposed → reminded → confirmed → delivered.
// "Send reminder" is simulated — no real outreach happens.
const NEXT = { proposed: "reminded", reminded: "confirmed", confirmed: "delivered" };
const ACTION_LABEL = { proposed: "Send reminder", reminded: "Mark confirmed", confirmed: "Mark delivered" };

export default function StatusControl({ eventId, partnerId }) {
  const status = useStatus();
  const current = status.statusOf(eventId, partnerId);
  const next = NEXT[current];

  return (
    <div className="status-control">
      <span className="status-chip" style={{ background: STATUS_COLOR[current] }}>{STATUS_LABEL[current]}</span>
      {next ? (
        <button className="btn btn-xs" onClick={() => status.setStatus(eventId, partnerId, next)}>
          {ACTION_LABEL[current]}
        </button>
      ) : (
        <button className="btn btn-xs btn-ghost" onClick={() => status.setStatus(eventId, partnerId, "proposed")}>
          Reset
        </button>
      )}
    </div>
  );
}
