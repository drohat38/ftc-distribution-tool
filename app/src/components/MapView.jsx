import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { partners, events, allocations } from "../data.js";
import { typeColor, typeLabel, fmtInt, fmtDate, fmtMiles } from "../format.js";

// Screen 2 — the map. Real partner pins (colored by type) + event markers. Uses OSM
// tiles (no Maps API key). CircleMarkers avoid Leaflet's default-icon asset issues.
export default function MapView({ onSelectEvent }) {
  const points = useMemo(
    () => [...partners.map((p) => [p.lat, p.lon]), ...events.map((e) => [e.lat, e.lon])],
    []
  );
  const bounds = points.length ? points : [[31, -98], [40, -96]];

  return (
    <div className="screen screen-map">
      <MapContainer bounds={bounds} boundsOptions={{ padding: [40, 40] }} scrollWheelZoom className="leaflet-host">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds bounds={bounds} />

        {partners.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{ color: "#fff", weight: 1, fillColor: typeColor(p.type), fillOpacity: 0.9 }}
          >
            <Popup>
              <div className="pop">
                <div className="pop-name">{p.name}</div>
                <div className="pop-type" style={{ color: typeColor(p.type) }}>{typeLabel(p.type)}</div>
                <div className="pop-row">
                  Capacity <b>~{fmtInt(p.capacityMeals)}</b> meals <span className="est">est</span>
                </div>
                <div className="pop-row">
                  Refrigeration <b>{p.hasRefrigeration ? "yes" : "no"}</b> <span className="est">est</span>
                </div>
                <div className="pop-row pop-src">source: {p.source}</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {events.map((e) => {
          const a = allocations[e.id];
          return (
            <CircleMarker
              key={e.id}
              center={[e.lat, e.lon]}
              radius={9}
              pathOptions={{
                color: "#fff",
                weight: 2,
                fillColor: a.overflow ? "#c5221f" : "#003366",
                fillOpacity: 1
              }}
            >
              <Popup>
                <div className="pop">
                  <div className="pop-kind">EVENT</div>
                  <div className="pop-name">{e.city}</div>
                  <div className="pop-type">{e.venue} · {fmtDate(e.date)}</div>
                  <div className="pop-row">Projected <b>{fmtInt(e.projectedMeals)}</b> meals</div>
                  <div className="pop-row">
                    Coverable <b>{fmtInt(a.totalAssigned)}</b>
                    {a.overflow ? <span className="chip chip-bad" style={{ marginLeft: 6 }}>short {fmtInt(a.shortfall)}</span> : null}
                  </div>
                  {e.needsRefrigeration ? <div className="pop-row">❄ needs cold storage</div> : null}
                  <button className="btn btn-sm" onClick={() => onSelectEvent(e.id)}>Open allocation →</button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div className="map-legend">
        <div className="ml-title">Legend</div>
        <Row color="#003366" label="Event" />
        <Row color="#c5221f" label="Event — overflow" />
        <Row color={typeColor("food_bank")} label="Food bank" />
        <Row color={typeColor("food_pantry")} label="Food pantry" />
        <Row color={typeColor("soup_kitchen")} label="Soup kitchen" />
        <Row color={typeColor("shelter")} label="Shelter" />
        <Row color={typeColor("community_centre")} label="Community center" />
      </div>
    </div>
  );
}

function Row({ color, label }) {
  return (
    <div className="ml-row">
      <span className="ml-dot" style={{ background: color }} /> {label}
    </div>
  );
}

// Imperatively fit bounds once the map is ready.
function FitBounds({ bounds }) {
  const map = useMap();
  if (bounds && bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  return null;
}
