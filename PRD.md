# Feed the City — Distribution Tool: PRD

*Product requirements. The "what" and "why." Agent operating rules are in `AGENTS.md`.*

---

## 1. Summary

An internal tool that maps Feed the City's **distribution network** — the
partner organizations that receive the food FTC events produce — and prevents
produced food from going to waste.

It is a sibling to the public event map (which shows where food is *made*). This
tool shows where food *goes*, and which event is connected to which partner(s).
The two link by `EventID`.

This is **not** a public portal, not volunteer-facing, not a real-time
"claim-a-slot" marketplace, and not a rebuild of the event map.

---

## 2. The problem

- Each FTC event distributes its food to a local partner org. Today that's
  usually **one** place, lined up by Nick (Tango ED) calling a contact.
- When an event produces more food than one partner can take, there's nowhere
  structured to send the surplus, and food risks being wasted.
- There's no shared, current picture of which partners exist, what they can
  take, whether they can refrigerate and distribute over the week, and which
  event is connected to whom.

The tool gives Nick and chapter leaders a maintained map of distribution
partners, a way to connect events to multiple partners, and a pre-event check so
food never has nowhere to go.

---

## 3. Scope

**In scope**
- A directory of distribution partners (the "universe") with the fields that
  decide whether food can move to them.
- An admin layer where Nick toggles a partner to "active" and assigns it to one
  or more events.
- A private map showing events, partners, and the links between them.
- A pre-event capacity check workflow.

**Out of scope (for now)**
- Public/volunteer-facing anything (the event map already covers volunteers).
- A real-time marketplace where partners post weekly capacity (the cadence is
  predictable; standing relationships fit better).
- Heavy infrastructure (Supabase / Airtable / Salesforce). This is the Tier A
  build on the stack already proven by the event map.

---

## 4. Architecture (decided)

- **Database:** Google Sheets, in a **separate workbook** from the public Events
  sheet.
- **Admin app:** Google Apps Script (`clasp`) inside the sheet. Reuses the event
  map's geocoding and status patterns.
- **Private map:** an Apps Script **web app**, gated by Google sign-in, reading
  Partners + Links server-side. Nothing is published publicly.
- **Link to events:** `EventID` (stable UUIDs already in the event map; sample
  in `reference/events-sample.csv`) is the foreign key joining events to
  partners.

**Privacy wall (critical):** partner data is internal and must never be written
to a published CSV or served on a public URL. The public event map keeps reading
only its own Events tab CSV and is unaffected by this project.

**Where partner data comes from:** Nick's ~50 already-agreed orgs are the first
records. Additional candidates can be seeded from Google Places (food pantries,
shelters) and, where available, a local 211 / Open Referral (HSDS) feed. External
sources provide the map pins; the FTC-specific fields are filled by outreach.

---

## 5. Data model

Adopt the HSDS ("Open Referral") shape so the data is standard and portable.
Full column-by-column schema lives in `docs/DATA_MODEL.md`.

**Partners**
- `PartnerID` (UUID)
- HSDS core: organization, location (address + lat/long), service, contact
- FTC fields:
  - `pathway` — `same-day` (serves immediately) or `hold-redistribute`
    (refrigerates and distributes over the week) — **required**
  - `cold_storage` — yes / no / capacity — **required**
  - `monthly_capacity_meals`
  - `recurring_slot` (e.g., "2nd Saturday")
  - `partnership_status` — candidate / active / paused
  - `assigned_chapter`
  - `agreement_on_file` (+ date)
  - `last_verified` — **the single most important field for keeping the tool
    alive; see §8**

**EventPartnerLinks** (the connection)
- `EventID` <-> `PartnerID`, **many-to-many** (one event → multiple partners;
  one partner → multiple events)
- Per-link: `active`, `recurring_slot`, `last_capacity_confirmed`

Geocode each partner address once and cache lat/long in the sheet; never
re-geocode on map load.

---

## 6. Food safety / compliance (a real product requirement)

The tool must encode the pathway, because Texas rules treat the two pathways
differently:

- **Same-day service** (shelter/soup kitchen serving that day): covered by Time
  as a Public Health Control — cold food made at ≤41°F, used within the time
  window. Easiest; most abundant.
- **Hold-and-redistribute** (partner with a fridge, distributes over the week):
  governed by the donation rule (TFER §228.64). The food must be **≤41°F at the
  time of donation**, the donor must be able to **substantiate the recipient has
  storage facilities**, and the food must be **labeled** (name, source, date of
  preparation).

So `cold_storage` is not a logistics note — it is a legal prerequisite for the
hold pathway. The UI must make the hold pathway visibly require a chilling step.

(Liability backdrop: the Bill Emerson Good Samaritan Act, strengthened by the
2023 Food Donation Improvement Act, protects donations of food that was safe and
compliant at handoff — it rewards doing this right, it does not excuse skipping
the cold chain.)

---

## 7. Key workflows

1. **Add / qualify a partner.** The qualifying questions ARE the data fields and
   double as compliance documentation: Do you have cold storage? Same-day serve
   or hold-and-distribute? How many meals can you take? Which Saturday, and can
   you commit to a recurring cadence?
2. **Activate + assign.** Nick toggles a candidate to active and links it to one
   or more events.
3. **Pre-event capacity check.** The week before an event, a leader confirms
   "can you take X this cycle?" with each active partner; responses are logged,
   with a ranked backup list if the primary can't absorb the full batch.
4. **View the distribution map.** Event pins, partner pins, and lines connecting
   each event to its partner(s) — the who-serves-whom picture.

---

## 8. The make-or-break requirement

Tools like this die from stale data: a leader trusts a pin, the partner has
moved or can't take the food, trust breaks, everyone reverts to texting Nick.

Therefore:
- **One named person owns the partner data** and runs a short monthly refresh.
- `last_verified` is visible on every record so users know what to trust.

If no one owns the data, the tool fails regardless of how well it's built. This
is a hard requirement, not a nice-to-have.

---

## 9. Roles

- **Admin** (Nick, Dev): full edit; toggle partners; assign to events.
- **Leader:** sees only their assigned partners; runs the capacity check.
- **Read-only:** view the map.

---

## 10. Build phases

1. **Scaffold** the repo (folders, stub files, clasp project, git remote +
   auto-push). No features yet.
2. **Partners tab + admin app** — schema, add/edit dialogs, geocoding, status.
3. **EventPartnerLinks + private map** — the join, the Apps Script web app,
   event↔partner lines.
4. **Capacity-check workflow** — pre-event confirmation + backup list.

---

## 11. Constraints / non-goals

- Thin shell over good data — the value is the partner data + compliance field,
  not the map UI. Don't over-build.
- Many-to-many via the link table, never a single partner column on an event.
- Privacy wall: partner data never public.
- Reuse the event map's stack and patterns; don't reinvent them; don't modify
  the map repo.
- Brand: orange `#FF6500`, navy `#003366`.
