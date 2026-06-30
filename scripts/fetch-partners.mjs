#!/usr/bin/env node
// Fetch candidate partner orgs from OpenStreetMap (Overpass API) for each configured
// region, normalize them, attach ESTIMATED operational fields, and cache the result to
// data/partners.json so the app never calls Overpass at runtime.
//
// Re-run any time to refresh:  node scripts/fetch-partners.mjs
//
// Data source: OpenStreetMap via Overpass (no API key). Respect the usage policy —
// this is a build-time fetch over a bounded area with a descriptive User-Agent, cached
// to disk. © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
//
// FALLBACK: if Overpass is unreachable after retries + mirror (e.g. a locked-down CI/
// sandbox network), the script writes a SMALL, CLEARLY-LABELED sample dataset
// (source: "sample-fallback") so the app still runs — and prints a loud warning. Run
// this script again from a normal network to replace it with real OSM data.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateOps } from "./lib/estimate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data/partners.json");
const USER_AGENT =
  "FTC-Distribution-Tool/1.0 (public-safe demo; OpenStreetMap data; +https://github.com/drohat38/ftc-distribution-tool)";
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const TIMEOUT_MS = 90000;
const MAX_RETRIES = 3;

const regionsCfg = JSON.parse(readFileSync(resolve(ROOT, "config/regions.json"), "utf8"));
const REGIONS = regionsCfg.regions;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Overpass QL for one region bbox: food banks, soup kitchens, shelters, and
// community centres (nodes + ways; `out center` gives ways a point).
function overpassQuery([s, w, n, e]) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:80];
(
  node["amenity"="social_facility"]["social_facility"~"food_bank|soup_kitchen|shelter"](${bbox});
  way["amenity"="social_facility"]["social_facility"~"food_bank|soup_kitchen|shelter"](${bbox});
  node["amenity"="food_bank"](${bbox});
  way["amenity"="food_bank"](${bbox});
  node["social_facility"~"food_bank|soup_kitchen|shelter"](${bbox});
  way["social_facility"~"food_bank|soup_kitchen|shelter"](${bbox});
  node["amenity"="community_centre"]["community_centre"~"food|social"](${bbox});
);
out center tags;`;
}

async function postOverpass(query) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain", "User-Agent": USER_AGENT },
          body: query,
          signal: ctl.signal
        });
        clearTimeout(t);
        if (res.status === 429 || res.status === 504) {
          throw new Error(`busy (HTTP ${res.status})`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
        const backoff = 2000 * attempt;
        console.warn(`  ! ${endpoint} attempt ${attempt} failed: ${err.message} — retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
    console.warn(`  ! giving up on ${endpoint}, trying next mirror`);
  }
  throw lastErr || new Error("all Overpass endpoints failed");
}

// Map raw OSM tags → our partner `type`.
function osmType(tags = {}) {
  const sf = tags.social_facility;
  if (sf === "food_bank") return "food_bank";
  if (sf === "soup_kitchen") return "soup_kitchen";
  if (sf === "shelter") return "shelter";
  if (tags.amenity === "food_bank") return "food_bank";
  if (tags.amenity === "community_centre") return "community_centre";
  return "other";
}

function buildAddress(tags = {}) {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"]
  ].filter(Boolean);
  return parts.join(", ");
}

function normalizeOsm(el) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const name = (tags.name || "").trim();
  if (!name) return null; // unnamed facilities aren't useful as map pins
  const osmId = `${el.type}/${el.id}`;
  const base = {
    id: osmId,
    name,
    type: osmType(tags),
    lat: +(+lat).toFixed(6),
    lon: +(+lon).toFixed(6),
    address: buildAddress(tags),
    phone: (tags.phone || tags["contact:phone"] || "").trim(),
    website: (tags.website || tags["contact:website"] || "").trim(),
    source: "OpenStreetMap",
    osmId
  };
  return { ...base, ...estimateOps(base) };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const key = p.osmId || `${p.name}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ---- Clearly-labeled fallback (only when Overpass is unreachable) ------------------
// Deterministic, fictional-but-plausible orgs spread across each region's bbox so the
// app and matching engine have realistic inputs. These are NOT real organizations and
// NOT OpenStreetMap data — source is "sample-fallback".
function buildFallback() {
  const ADJ = ["Trinity", "Bluebonnet", "Eastside", "Hillcrest", "Lakeview", "Mosaic",
    "Crossroads", "Northgate", "Riverside", "Sunrise", "Cedar", "Harmony",
    "Prairie", "Magnolia", "Summit", "Garland", "Oakwood", "Brightway"];
  const TYPES = [
    { type: "food_bank", label: "Food Bank" },
    { type: "food_pantry", label: "Food Pantry" },
    { type: "soup_kitchen", label: "Community Kitchen" },
    { type: "shelter", label: "Family Shelter" },
    { type: "community_centre", label: "Community Center" }
  ];
  const out = [];
  for (const region of REGIONS) {
    const [s, w, n, e] = region.bbox;
    const perRegion = 12;
    for (let i = 0; i < perRegion; i++) {
      const u1 = (Math.sin((i + 1) * 12.9898 + s) * 43758.5453) % 1;
      const u2 = (Math.sin((i + 1) * 78.233 + w) * 24634.6345) % 1;
      const f1 = Math.abs(u1), f2 = Math.abs(u2);
      const lat = +(s + (n - s) * (0.1 + 0.8 * f1)).toFixed(6);
      const lon = +(w + (e - w) * (0.1 + 0.8 * f2)).toFixed(6);
      const tdef = TYPES[(i + region.id.length) % TYPES.length];
      const adj = ADJ[(i * 3 + region.id.length) % ADJ.length];
      const id = `sample/${region.id}/${i}`;
      const base = {
        id,
        name: `${adj} ${tdef.label}`,
        type: tdef.type,
        lat,
        lon,
        address: `${region.name} (approx.)`,
        phone: "",
        website: "",
        source: "sample-fallback",
        osmId: null
      };
      out.push({ ...base, ...estimateOps(base) });
    }
  }
  return out;
}

// ---- Main --------------------------------------------------------------------------
async function main() {
  console.log(`Sourcing partners for ${REGIONS.length} region(s): ${REGIONS.map((r) => r.id).join(", ")}`);
  let all = [];
  let liveOk = false;

  for (const region of REGIONS) {
    try {
      console.log(`\n→ ${region.name} [${region.id}]`);
      const json = await postOverpass(overpassQuery(region.bbox));
      const normalized = (json.elements || []).map(normalizeOsm).filter(Boolean);
      console.log(`  found ${normalized.length} named org(s)`);
      if (normalized.length === 0) {
        console.warn(`  ⚠ 0 results for ${region.id} — consider broadening the query or bbox.`);
      }
      all = all.concat(normalized);
      liveOk = true;
      await sleep(1500); // be polite to Overpass between regions
    } catch (err) {
      console.error(`  ✗ ${region.id} failed: ${err.message}`);
    }
  }

  all = dedupe(all);

  let meta;
  if (liveOk && all.length > 0) {
    meta = {
      mode: "live",
      source: "OpenStreetMap (Overpass API)",
      license: "ODbL — © OpenStreetMap contributors",
      regions: REGIONS.map((r) => r.id),
      count: all.length,
      note: "Operational fields (capacityMeals, hasRefrigeration, acceptedFoodTypes, openDays) are ESTIMATES — see scripts/lib/estimate.mjs."
    };
    console.log(`\n✓ LIVE: ${all.length} real OSM org(s) across ${REGIONS.length} region(s).`);
  } else {
    all = dedupe(buildFallback());
    meta = {
      mode: "fallback",
      source: "sample-fallback (NOT real, NOT OpenStreetMap)",
      reason: "Overpass API was unreachable from this environment after retries + mirror.",
      license: "n/a — synthetic sample data",
      regions: REGIONS.map((r) => r.id),
      count: all.length,
      note: "Re-run `node scripts/fetch-partners.mjs` from a normal network to replace this with real OpenStreetMap data."
    };
    console.warn("\n" + "=".repeat(72));
    console.warn("⚠  FALLBACK DATA IN USE — Overpass was unreachable from this environment.");
    console.warn("⚠  data/partners.json contains SYNTHETIC sample orgs (source: sample-fallback),");
    console.warn("⚠  NOT real OpenStreetMap organizations. Re-run this script on an open network");
    console.warn("⚠  to fetch real data. The app labels this provenance in its banner.");
    console.warn("=".repeat(72));
  }

  // Per-region counts for the log.
  const byRegion = {};
  for (const p of all) {
    let rid = "out-of-region";
    for (const r of REGIONS) {
      const [s, w, n, e] = r.bbox;
      if (p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e) { rid = r.id; break; }
    }
    byRegion[rid] = (byRegion[rid] || 0) + 1;
  }
  console.log("Per-region counts:", JSON.stringify(byRegion));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ _meta: meta, partners: all }, null, 2) + "\n");
  console.log(`\nWrote ${all.length} partner(s) → ${OUT} (mode: ${meta.mode})`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
