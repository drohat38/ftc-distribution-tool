import { describe, it, expect } from "vitest";
import { evaluatePartner, allocateEvent, rankBackups, summarize, allocateCycle } from "./matching.js";
import cfg from "@config/matching.json";

// Small explicit fixtures so the engine's behavior is asserted deterministically,
// independent of the generated dataset.
const partner = (over) => ({
  id: "x",
  name: "X",
  type: "food_pantry",
  lat: 32.9,
  lon: -97.0,
  capacityMeals: 300,
  hasRefrigeration: true,
  acceptedFoodTypes: ["packaged"],
  ...over
});

describe("refrigeration exclusion (hard constraint)", () => {
  it("excludes a no-fridge partner when the event needs refrigeration", () => {
    const event = { id: "e", lat: 32.9, lon: -97.0, projectedMeals: 100, needsRefrigeration: true };
    const r = evaluatePartner(partner({ hasRefrigeration: false }), event, cfg);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/refriger/i);
  });

  it("includes the SAME partner when the event does not need refrigeration", () => {
    const event = { id: "e", lat: 32.9, lon: -97.0, projectedMeals: 100, needsRefrigeration: false };
    const r = evaluatePartner(partner({ hasRefrigeration: false }), event, cfg);
    expect(r.eligible).toBe(true);
  });

  it("a fridge-needing event excludes no-fridge partners from its allocation", () => {
    const event = { id: "e", lat: 32.9, lon: -97.0, projectedMeals: 200, needsRefrigeration: true };
    const ps = [
      partner({ id: "cold", lat: 32.91, lon: -97.0, hasRefrigeration: true, capacityMeals: 200 }),
      partner({ id: "warm", lat: 32.905, lon: -97.0, hasRefrigeration: false, capacityMeals: 999 })
    ];
    const r = allocateEvent(event, ps, cfg);
    expect(r.assignments.map((a) => a.partnerId)).toEqual(["cold"]);
    expect(r.ineligible.find((p) => p.partnerId === "warm").reasons.join()).toMatch(/refriger/i);
  });
});

describe("overflow → ranked backups", () => {
  const event = { id: "e", lat: 32.9, lon: -97.0, projectedMeals: 1000, needsRefrigeration: false };
  const partners = [
    partner({ id: "near1", lat: 32.91, lon: -97.0, capacityMeals: 300 }), // ~0.7 mi
    partner({ id: "near2", lat: 32.92, lon: -97.0, capacityMeals: 300 }), // ~1.4 mi
    partner({ id: "near3", lat: 32.95, lon: -97.0, capacityMeals: 200, type: "food_bank" }), // ~3.5 mi
    partner({ id: "far", lat: 33.3, lon: -97.0, capacityMeals: 500, type: "food_bank" }) // ~27.6 mi (out of 25)
  ];

  it("flags overflow when eligible capacity < projected meals", () => {
    const r = allocateEvent(event, partners, cfg);
    expect(r.totalAssigned).toBe(800); // 300 + 300 + 200, far is out of radius
    expect(r.shortfall).toBe(200);
    expect(r.overflow).toBe(true);
  });

  it("allocates closest partner first (greedy best-fit)", () => {
    const r = allocateEvent(event, partners, cfg);
    expect(r.assignments[0].partnerId).toBe("near1");
  });

  it("surfaces the out-of-radius partner as a flagged expansion backup", () => {
    const r = allocateEvent(event, partners, cfg);
    const far = r.backups.find((b) => b.partnerId === "far");
    expect(far).toBeTruthy();
    expect(far.expansion).toBe(true);
  });

  it("ranks in-radius alternates by free capacity, then distance", () => {
    const small = { ...event, projectedMeals: 250 }; // near1 (300) covers it alone
    const r = allocateEvent(small, partners, cfg);
    expect(r.overflow).toBe(false);
    const inRadius = r.backups.filter((b) => !b.expansion).map((b) => b.partnerId);
    expect(inRadius).toContain("near2");
    expect(inRadius).toContain("near3");
    // near2 (cap 300) outranks near3 (cap 200)
    expect(inRadius.indexOf("near2")).toBeLessThan(inRadius.indexOf("near3"));
  });
});

describe("radius exclusion", () => {
  it("excludes partners beyond the max radius", () => {
    const event = { id: "e", lat: 32.9, lon: -97.0, projectedMeals: 100, needsRefrigeration: false };
    const r = evaluatePartner(partner({ lat: 34.0, lon: -97.0 }), event, cfg); // ~76 mi
    expect(r.eligible).toBe(false);
    expect(r.reasons.join()).toMatch(/radius/i);
  });
});

describe("time-phased cycle allocation", () => {
  const one = (over) => partner({ id: "only", capacityMeals: 300, lat: 32.9, lon: -97.0, ...over });

  it("same-date events compete for one partner's capacity (contention → overflow)", () => {
    const partners = [one()];
    const events = [
      { id: "e1", date: "2026-07-04", lat: 32.9, lon: -97.0, projectedMeals: 200, needsRefrigeration: false },
      { id: "e2", date: "2026-07-04", lat: 32.9, lon: -97.0, projectedMeals: 200, needsRefrigeration: false }
    ];
    const { allocations, summary } = allocateCycle(events, partners, cfg);
    // The shared partner only has 300 meals that morning, not 600.
    expect(allocations.e1.totalAssigned + allocations.e2.totalAssigned).toBe(300);
    expect(allocations.e1.overflow || allocations.e2.overflow).toBe(true);
    expect(summary.overflowCount).toBe(1);
  });

  it("the same partner serves both when events are on different dates (replenish)", () => {
    const partners = [one()];
    const events = [
      { id: "e1", date: "2026-07-04", lat: 32.9, lon: -97.0, projectedMeals: 200, needsRefrigeration: false },
      { id: "e2", date: "2026-07-11", lat: 32.9, lon: -97.0, projectedMeals: 200, needsRefrigeration: false }
    ];
    const { allocations } = allocateCycle(events, partners, cfg);
    expect(allocations.e1.totalAssigned).toBe(200);
    expect(allocations.e2.totalAssigned).toBe(200);
    expect(allocations.e1.overflow).toBe(false);
    expect(allocations.e2.overflow).toBe(false);
  });
});

describe("cycle summary", () => {
  it("totals projected, assigned, and shortfall across events", () => {
    const events = [
      { id: "a", lat: 32.9, lon: -97.0, projectedMeals: 100, needsRefrigeration: false },
      { id: "b", lat: 32.9, lon: -97.0, projectedMeals: 1000, needsRefrigeration: false }
    ];
    const ps = [partner({ id: "p1", capacityMeals: 300 })];
    const s = summarize(events, ps, cfg);
    expect(s.totalProjected).toBe(1100);
    expect(s.totalAssigned).toBe(400); // 100 + 300
    expect(s.totalShortfall).toBe(700);
    expect(s.overflowCount).toBe(1);
  });
});
