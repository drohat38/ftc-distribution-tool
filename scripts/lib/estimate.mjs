// Deterministic estimation of OPERATIONAL fields from an org's public type.
//
// IMPORTANT — HONEST BY DESIGN: public directories (OpenStreetMap) do NOT publish
// meal-acceptance capacity, refrigeration, accepted food types, or operating days.
// These are *estimates* produced by the documented heuristic below, seeded by the
// org's stable id so values never change between runs. Every field produced here is
// flagged `estimated: true`. The whole point of the confirmation workflow is to turn
// each estimate into a confirmed value — never present these as real figures.

// Per-type profile. `rank` = preference when food types are equal (food bank can
// absorb the most, shelter the least). `baseCapacity` = typical meals/event before
// jitter. `fridgeChance` = probability the org has refrigeration. `accepts` = food
// types the type can take (FTC packs shelf-stable "packaged" meals).
export const TYPE_PROFILE = {
  food_bank:        { rank: 5, baseCapacity: 900, fridgeChance: 0.92, accepts: ["packaged", "perishable", "dry"] },
  food_pantry:      { rank: 4, baseCapacity: 450, fridgeChance: 0.65, accepts: ["packaged", "dry"] },
  soup_kitchen:     { rank: 3, baseCapacity: 300, fridgeChance: 0.55, accepts: ["packaged", "perishable"] },
  shelter:          { rank: 2, baseCapacity: 180, fridgeChance: 0.45, accepts: ["packaged"] },
  community_centre: { rank: 1, baseCapacity: 120, fridgeChance: 0.30, accepts: ["packaged"] },
  other:            { rank: 0, baseCapacity: 90,  fridgeChance: 0.20, accepts: ["packaged"] }
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Stable FNV-1a hash → unit float in [0,1). Same input always yields the same value,
// so the dataset is identical across runs (no Math.random()).
export function seededUnit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Estimate the operational fields for one partner. Deterministic in `osmId`/`id`.
export function estimateOps(partner) {
  const profile = TYPE_PROFILE[partner.type] || TYPE_PROFILE.other;
  const id = String(partner.osmId || partner.id || partner.name || "x");

  const capJitter = 0.7 + 0.6 * seededUnit(id + "|cap"); // 0.7 .. 1.3
  const capacityMeals = Math.max(40, Math.round((profile.baseCapacity * capJitter) / 10) * 10);

  const hasRefrigeration = seededUnit(id + "|fridge") < profile.fridgeChance;

  // 3–6 open days, biased toward weekdays.
  const openDays = DOW.filter((_, i) => seededUnit(id + "|day" + i) < 0.62);
  const days = openDays.length >= 2 ? openDays : ["Mon", "Wed", "Fri"];

  return {
    capacityMeals,
    hasRefrigeration,
    acceptedFoodTypes: profile.accepts,
    openDays: days,
    // Provenance for the UI: these four fields are estimates pending confirmation.
    estimated: true,
    estimatedFields: ["capacityMeals", "hasRefrigeration", "acceptedFoodTypes", "openDays"]
  };
}
