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
export function rankBackups(event, partners, cfg, assignedIds = new Set(), remainingMap = null) {
  const rankOf = (t) => (cfg.typeRank && cfg.typeRank[t]) || 0;
  const cmp = (a, b) =>
    b.freeCapacity - a.freeCapacity ||
    a.distance - b.distance ||
    rankOf(b.type) - rankOf(a.type);

  // When a remaining-capacity map is supplied (cycle allocation), a partner's free
  // capacity is what's LEFT after earlier same-date events — not its full capacity.
  const freeOf = (p) => (remainingMap ? (remainingMap.get(p.id) ?? p.capacityMeals) : p.capacityMeals);

  const evals = partners
    .filter((p) => !assignedIds.has(p.id))
    .map((p) => ({ partner: p, ...evaluatePartner(p, event, cfg) }));

  const toRow = (e, expansion) => ({
    partnerId: e.partner.id,
    name: e.partner.name,
    type: e.partner.type,
    distance: e.distance,
    freeCapacity: freeOf(e.partner),
    hasRefrigeration: e.partner.hasRefrigeration,
    expansion
  });

  // In-radius backups must have capacity left to be useful.
  const inRadius = evals.filter((e) => e.eligible && freeOf(e.partner) > 0).map((e) => toRow(e, false)).sort(cmp);

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

// Roll up a whole cycle for the dashboard (independent per-event allocation).
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

// ============================================================================
// TIME-PHASED (CYCLE) ALLOCATION — the realistic model.
//
// A partner's capacity is per SERVICE DATE: events on the SAME date compete for the
// same partners (a pantry can't absorb every Saturday-morning event at once), while
// events on different dates each see the partner's capacity replenished. Within a
// date, the most-constrained events (fewest eligible partners) are allocated first so
// they aren't starved by larger events grabbing shared capacity.
//
// Returns per-event allocations (same shape as allocateEvent) plus partnerLoad
// (committed meals per partner per date) so the UI can show contention.
// ============================================================================
export function allocateCycle(events, partners, cfg) {
  const byDate = new Map();
  for (const e of events) {
    const d = e.date || "no-date";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(e);
  }

  const allocations = {};
  const partnerLoad = {}; // partnerId -> { date -> committedMeals }

  for (const [date, evs] of byDate) {
    const remaining = new Map(partners.map((p) => [p.id, p.capacityMeals]));

    // Most-constrained-first within the date (fewest eligible partners), then larger
    // projected meals — so tight events get the shared capacity before big ones.
    const order = evs
      .map((e) => ({ e, elig: partners.reduce((n, p) => n + (evaluatePartner(p, e, cfg).eligible ? 1 : 0), 0) }))
      .sort((a, b) => a.elig - b.elig || b.e.projectedMeals - a.e.projectedMeals)
      .map((x) => x.e);

    for (const e of order) {
      const evals = partners.map((p) => ({ partner: p, ...evaluatePartner(p, e, cfg) }));
      const eligible = evals
        .filter((x) => x.eligible)
        .sort((a, b) => a.distance - b.distance || remaining.get(b.partner.id) - remaining.get(a.partner.id));

      const assignments = [];
      let need = e.projectedMeals;
      let contended = false;
      for (const x of eligible) {
        if (need <= 0) break;
        const avail = remaining.get(x.partner.id);
        if (avail < x.partner.capacityMeals) contended = true; // earlier same-date event used some
        if (avail <= 0) continue;
        const meals = Math.min(need, avail);
        assignments.push({
          partnerId: x.partner.id,
          name: x.partner.name,
          type: x.partner.type,
          distance: x.distance,
          capacityMeals: x.partner.capacityMeals,
          remainingBefore: avail,
          meals
        });
        remaining.set(x.partner.id, avail - meals);
        need -= meals;
        partnerLoad[x.partner.id] = partnerLoad[x.partner.id] || {};
        partnerLoad[x.partner.id][date] = (partnerLoad[x.partner.id][date] || 0) + meals;
      }

      const shortfall = Math.max(0, need);
      const assignedIds = new Set(assignments.map((a) => a.partnerId));
      allocations[e.id] = {
        eventId: e.id,
        date,
        projectedMeals: e.projectedMeals,
        totalAssigned: e.projectedMeals - shortfall,
        shortfall,
        overflow: shortfall > 0,
        contended,
        assignments,
        eligibleCount: eligible.length,
        ineligible: evals
          .filter((x) => !x.eligible)
          .sort((a, b) => a.distance - b.distance)
          .map((x) => ({ partnerId: x.partner.id, name: x.partner.name, type: x.partner.type, distance: x.distance, reasons: x.reasons })),
        backups: rankBackups(e, partners, cfg, assignedIds, remaining)
      };
    }
  }

  const list = Object.values(allocations);
  return {
    allocations,
    partnerLoad,
    summary: {
      eventCount: events.length,
      totalProjected: events.reduce((s, e) => s + e.projectedMeals, 0),
      totalAssigned: list.reduce((s, a) => s + a.totalAssigned, 0),
      totalShortfall: list.reduce((s, a) => s + a.shortfall, 0),
      overflowCount: list.filter((a) => a.overflow).length,
      contendedCount: list.filter((a) => a.contended).length
    }
  };
}
