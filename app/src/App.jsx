import { useState } from "react";
import Banner from "./components/Banner.jsx";
import Dashboard from "./components/Dashboard.jsx";
import MapView from "./components/MapView.jsx";
import Overflow from "./components/Overflow.jsx";
import Confirmations from "./components/Confirmations.jsx";
import EventDrilldown from "./components/EventDrilldown.jsx";
import { cycleSummary, eventsMeta } from "./data.js";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "map", label: "Map" },
  { id: "overflow", label: "Overflow" },
  { id: "confirmations", label: "Confirmations" }
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const open = (id) => setSelectedEvent(id);
  const close = () => setSelectedEvent(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
            <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" />
          </svg>
        </div>
        <div className="brand">
          <h1>FTC Distribution Matcher</h1>
          <div className="brand-sub">Match meal-packing events to partners that can receive the food · confirm capacity before the event</div>
        </div>
        <div className="topbar-stat">
          <div className="ts-val">{cycleSummary.overflowCount}</div>
          <div className="ts-lbl">events short</div>
        </div>
      </header>

      <Banner />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "overflow" && cycleSummary.overflowCount ? <span className="tab-badge">{cycleSummary.overflowCount}</span> : null}
          </button>
        ))}
        <div className="tabs-spacer" />
        <div className="tabs-meta" title={eventsMeta.note}>Cycle anchored {eventsMeta.anchorDate}</div>
      </nav>

      <main className="main">
        {tab === "dashboard" && <Dashboard onSelectEvent={open} />}
        {tab === "map" && <MapView onSelectEvent={open} />}
        {tab === "overflow" && <Overflow onSelectEvent={open} />}
        {tab === "confirmations" && <Confirmations onSelectEvent={open} />}
      </main>

      {selectedEvent ? <EventDrilldown eventId={selectedEvent} onClose={close} /> : null}
    </div>
  );
}
