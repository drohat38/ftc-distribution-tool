#!/usr/bin/env node
// Build data/events.json from the REAL FTC public event data
// (reference/events-sample.csv — a snapshot of the sibling feed-the-city-event-map's
// published Google Sheet). Each event gets a computed next-occurrence date (from its
// Saturday-of-month cycle) plus ESTIMATED projectedMeals and needsRefrigeration.
//
// Re-run:  node scripts/build-events.mjs
//
// projectedMeals / needsRefrigeration are deterministic estimates seeded by EventID —
// the public event sheet does not publish them. They are clearly an estimated input to
// the matching demo, not real FTC figures.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv.mjs";
import { seededUnit } from "./lib/estimate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data/events.json");
const CSV = resolve(ROOT, "reference/events-sample.csv");

const regionsCfg = JSON.parse(readFileSync(resolve(ROOT, "config/regions.json"), "utf8"));
const REGIONS = regionsCfg.regions;

// Anchor for next-occurrence math. Fixed (not "now") so the dataset is stable across
// runs. Today's context date is 2026-06-30, so we schedule the upcoming cycle.
const ANCHOR = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01

const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };

// The date of the Nth (or last) Saturday of a given month.
function nthSaturday(year, month0, n) {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month0 + 1, 0));
    const back = (last.getUTCDay() - 6 + 7) % 7;
    return new Date(Date.UTC(year, month0, last.getUTCDate() - back));
  }
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (6 - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const dim = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return day > dim ? null : new Date(Date.UTC(year, month0, day));
}

// Next occurrence of a Saturday-of-month cycle on/after the anchor.
function nextOccurrence(cycle, from) {
  const n = ORDINAL[String(cycle || "").trim().toLowerCase()];
  if (!n) return null;
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  for (let i = 0; i < 6; i++) {
    const d = nthSaturday(y, m, n);
    if (d && d >= from) return d;
    m++; if (m > 11) { m = 0; y++; }
  }
  return null;
}

function regionOf(lat, lon) {
  for (const r of REGIONS) {
    const [s, w, n, e] = r.bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) return r.id;
  }
  return null;
}

const rows = parseCsv(readFileSync(CSV, "utf8"));
const events = [];
let skippedNoCoord = 0, skippedOutOfRegion = 0;

for (const r of rows) {
  const id = (r.EventID || "").trim();
  const lat = parseFloat(r.Latitude);
  const lon = parseFloat(r.Longitude);
  if (!id || !isFinite(lat) || !isFinite(lon)) { skippedNoCoord++; continue; }

  const region = regionOf(lat, lon);
  if (!region) { skippedOutOfRegion++; continue; } // keep the demo to regions with partner coverage

  const occ = nextOccurrence(r.Saturday, ANCHOR);
  // projectedMeals: 200..1200 (step 50), seeded by EventID.
  const projectedMeals = 200 + Math.round((seededUnit(id + "|meals") * 1000) / 50) * 50;
  // ~42% of events need refrigeration (e.g. perishable batches).
  const needsRefrigeration = seededUnit(id + "|fridge") < 0.42;

  events.push({
    id,
    city: (r.City || "").trim(),
    state: (r.State || "").trim(),
    venue: (r.Venue || "").trim(),
    cycle: (r.Saturday || "").trim(),
    date: occ ? occ.toISOString().slice(0, 10) : null,
    region,
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
    projectedMeals,
    needsRefrigeration,
    estimatedFields: ["projectedMeals", "needsRefrigeration"]
  });
}

events.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.city.localeCompare(b.city));

const meta = {
  source: "reference/events-sample.csv (real FTC public event data — feed-the-city-event-map published sheet)",
  anchorDate: ANCHOR.toISOString().slice(0, 10),
  regions: REGIONS.map((r) => r.id),
  count: events.length,
  skippedNoCoord,
  skippedOutOfRegion,
  note: "projectedMeals + needsRefrigeration are deterministic ESTIMATES seeded by EventID; the public event sheet does not publish them."
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ _meta: meta, events }, null, 2) + "\n");
console.log(`Wrote ${events.length} event(s) → ${OUT}`);
console.log(`  (skipped ${skippedNoCoord} without coords, ${skippedOutOfRegion} outside configured regions)`);
const byRegion = {};
events.forEach((e) => { byRegion[e.region] = (byRegion[e.region] || 0) + 1; });
console.log("  per-region:", JSON.stringify(byRegion));
