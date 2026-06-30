// ============================================================================
// MATCHING ENGINE — the core. Pure, deterministic, dependency-free functions.
//
// Given an event (city, coords, projectedMeals, needsRefrigeration) and the partner
// universe, it:
//   1. evaluates each partner against the event's HARD CONSTRAINTS,
//   2. greedily allocates projectedMeals across eligible partners (closest first),
//   3. flags OVERFLOW (shortfall) when eligible capacity can't cover the meals, and
//   4. produces a RANKED BACKUP list (free capacity → distance → type fit), including
//      just-out-of-radius "expansion" candidates as an actionable next step.
//
// Nothing here is hardcoded per event — every assignment is computed from the data and
// the tunables in config/matching.json. See app/src/lib/matching.test.js for the
// overflow→backup and refrigeration-exclusion cases.
// ============================================================================
import { haversineMiles } from "./geo.js";

// Evaluate ONE partner against an event. Returns distance, eligibility, and the
// human-readable reason(s) it was excluded (used to grey out partners in the UI).
export function evaluatePartner(partner, event, cfg) {
  const distance = haversineMiles(event.lat, event.lon, partner.lat, partner.lon);
  const reasons = [];

  if (distance > cfg.maxRadiusMiles) {
    reasons.push(`Outside ${cfg.maxRadiusMiles} mi radius (${distance.toFixed(1)} mi away)`);
  }
  if (event.needsRefrigeration && !partner.hasRefrigeration) {
    reasons.push("No refrigeration — event needs cold storage");
  }
  if (!(partner.acceptedFoodTypes || []).includes(cfg.requiredFoodType)) {
    reasons.push(`Doesn't accept ${cfg.requiredFoodType} meals`);
  }

  return { partnerId: partner.id, distance, eligible: reasons.length === 0, reasons };
}

// Allocate an event's projected meals across eligible partners.
export function allocateEvent(event, partners, cfg) {
  const evals = partners.map((p) => ({ partner: p, ...evaluatePartner(p, event, cfg) }));

  // Eligible partners, CLOSEST FIRST then larger capacity (greedy best-fit).
  const eligible = evals
    .filter((e) => e.eligible)
    .sort((a, b) => a.distance - b.distance || b.partner.capacityMeals - a.partner.capacityMeals);

  const ineligible = evals
    .filter((e) => !e.eligible)
    .sort((a, b) => a.distance - b.distance);

  const assignments = [];
  let remaining = event.projectedMeals;
  for (const e of eligible) {
    if (remaining <= 0) break;
    const meals = Math.min(remaining, e.partner.capacityMeals);
    assignments.push({
      partnerId: e.partner.id,
      name: e.partner.name,
      type: e.partner.type,
      distance: e.distance,
      capacityMeals: e.partner.capacityMeals,
      meals
    });
    remaining -= meals;
  }

  const shortfall = Math.max(0, remaining);
  const totalAssigned = event.projectedMeals - shortfall;
  const assignedIds = new Set(assignments.map((a) => a.partnerId));

  return {
    eventId: event.id,
    projectedMeals: event.projectedMeals,
    totalAssigned,
    shortfall,
    overflow: shortfall > 0,
    assignments,
    eligibleCount: eligible.length,
    ineligible: ineligible.map((e) => ({
      partnerId: e.partner.id,
      name: e.partner.name,
      type: e.partner.type,
      distance: e.distance,
      reasons: e.reasons
    })),
    backups: rankBackups(event, partners, cfg, assignedIds)
  };
}

// Ranked backups: partners NOT already assigned, sorted by free capacity, then
// distance, then type fit. In-radius eligible partners rank first; partners that fail
// ONLY the radius test (within the expand factor) follow as flagged "expansion"
// candidates so an overflowing event always has an actionable next step.
export function rankBackups(event, partners, cfg, assignedIds = new Set()) {
  const rankOf = (t) => (cfg.typeRank && cfg.typeRank[t]) || 0;
  const cmp = (a, b) =>
    b.freeCapacity - a.freeCapacity ||
    a.distance - b.distance ||
    rankOf(b.type) - rankOf(a.type);

  const evals = partners
    .filter((p) => !assignedIds.has(p.id))
    .map((p) => ({ partner: p, ...evaluatePartner(p, event, cfg) }));

  const toRow = (e, expansion) => ({
    partnerId: e.partner.id,
    name: e.partner.name,
    type: e.partner.type,
    distance: e.distance,
    freeCapacity: e.partner.capacityMeals,
    hasRefrigeration: e.partner.hasRefrigeration,
    expansion
  });

  const inRadius = evals.filter((e) => e.eligible).map((e) => toRow(e, false)).sort(cmp);

  const expandMax = cfg.maxRadiusMiles * (cfg.backupExpandRadiusFactor || 1.5);
  const expansion = evals
    .filter(
      (e) =>
        !e.eligible &&
        e.reasons.length === 1 &&
        /radius/i.test(e.reasons[0]) &&
        e.distance <= expandMax
    )
    .map((e) => toRow(e, true))
    .sort(cmp);

  return [...inRadius, ...expansion];
}

// Roll up a whole cycle for the dashboard.
export function summarize(events, partners, cfg) {
  const allocations = events.map((e) => allocateEvent(e, partners, cfg));
  return {
    allocations,
    eventCount: events.length,
    totalProjected: events.reduce((s, e) => s + e.projectedMeals, 0),
    totalAssigned: allocations.reduce((s, a) => s + a.totalAssigned, 0),
    totalShortfall: allocations.reduce((s, a) => s + a.shortfall, 0),
    overflowCount: allocations.filter((a) => a.overflow).length
  };
}
