import { usingFallback, partnersMeta } from "../data.js";

// Persistent provenance + honesty banner. Always visible.
export default function Banner() {
  return (
    <div className={"banner" + (usingFallback ? " banner-warn" : "")}>
      <strong>Candidate partners are sourced from public OpenStreetMap data — NOT confirmed Feed the City partners.</strong>{" "}
      Capacity, refrigeration, accepted food types, and open days are <em>estimates pending confirmation</em>.
      {usingFallback ? (
        <span className="banner-fallback">
          {" "}⚠ This build is showing <b>synthetic sample data</b> ({partnersMeta.count} orgs) because the
          OpenStreetMap Overpass API was unreachable when the data was generated. Re-run{" "}
          <code>node scripts/fetch-partners.mjs</code> on an open network for real orgs.
        </span>
      ) : null}{" "}
      <span className="attrib">© OpenStreetMap contributors (ODbL)</span>
    </div>
  );
}
