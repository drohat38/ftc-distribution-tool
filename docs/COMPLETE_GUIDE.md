# FTC Distribution Tool — The Complete Guide

> The single, exhaustive reference for this tool: what it is, who it's for, why it
> exists, how every piece works, and every nuance, rule, and gotcha. If something
> here disagrees with the code, the code wins and this file is a bug — but it is
> written from the code as of the "finish-the-app" build.
>
> Companion docs: [`AGENTS.md`](../AGENTS.md) (hard rules for contributors),
> [`PRD.md`](../PRD.md) (the what & why), [`docs/DATA_MODEL.md`](DATA_MODEL.md)
> (the column-by-column contract), [`docs/PUBLIC_MAP.md`](PUBLIC_MAP.md) (deploy
> guide), [`docs/SMOKE_TEST.md`](SMOKE_TEST.md) (manual test checklist).

---

## Table of contents

1. [What this is, in one paragraph](#1-what-this-is-in-one-paragraph)
2. [The problem it solves](#2-the-problem-it-solves)
3. [Who it's for (audience & roles)](#3-who-its-for-audience--roles)
4. [The two surfaces](#4-the-two-surfaces)
5. [Architecture & stack](#5-architecture--stack)
6. [The privacy wall (the most important rule)](#6-the-privacy-wall-the-most-important-rule)
7. [Food safety & legal compliance](#7-food-safety--legal-compliance)
8. [The monthly cycle (how it's actually used)](#8-the-monthly-cycle-how-its-actually-used)
9. [The data model — every tab, every column](#9-the-data-model--every-tab-every-column)
10. [The `FTC` menu — every action](#10-the-ftc-menu--every-action)
11. [Deep dives on the tricky logic](#11-deep-dives-on-the-tricky-logic)
12. [The public distribution map](#12-the-public-distribution-map)
13. [Automation — triggers & background jobs](#13-automation--triggers--background-jobs)
14. [Configuration & stored state](#14-configuration--stored-state)
15. [Setup & deployment, end to end](#15-setup--deployment-end-to-end)
16. [Function reference (Apps Script)](#16-function-reference-apps-script)
17. [Design principles & invariants](#17-design-principles--invariants)
18. [Nuances, edge cases & gotchas](#18-nuances-edge-cases--gotchas)
19. [What is NOT built](#19-what-is-not-built)
20. [Project history (phases)](#20-project-history-phases)
21. [Glossary](#21-glossary)
22. [What can't be verified without Google](#22-what-cant-be-verified-without-google)

---

## 1. What this is, in one paragraph

The **FTC Distribution Tool** is an internal logistics tool for **Feed the City**, a
program of **Tango Charities**. Feed the City runs volunteer cooking events (mostly
at restaurants/breweries, on a fixed Saturday-of-the-month per city) that produce
prepared meals. Those meals have to **go somewhere** — to partner organizations
(food pantries, food banks, soup kitchens, shelters) that distribute them. This tool
is the maintained map and back office for that distribution network: who the
partners are, what they can take, whether they can legally hold the food, which
event is connected to which partner(s), and a weekly nudge so food never has nowhere
to go. It is the **sibling** of the public **event map** (`feed-the-city-event-map`):
the event map shows where food is **made** (public, volunteer-facing); this tool maps
where food **goes**. The two are joined by a shared `EventID`.

---

## 2. The problem it solves

- Each Feed the City event distributes its food to a local partner org. Historically
  that's **one** place, lined up by **Nick** (Tango's ED) phoning a contact.
- When an event produces more food than one partner can take, there's no structured
  place to send the surplus, so **food risks being wasted**.
- There's no shared, current picture of which partners exist, what they can absorb,
  whether they can refrigerate and distribute over the week, and which event is
  connected to whom.
- Tools like this **die from stale data**: a leader trusts a pin, the partner has
  moved or can't take the food, trust breaks, and everyone reverts to texting Nick.
  So the tool is built around keeping the data trustworthy (`last_verified`, an owner,
  a weekly reminder loop), not around a fancy UI.

The tool gives Nick and chapter leaders a maintained directory of partners, a
many-to-many way to connect events to partners, a pre-event confirmation loop, and a
public display map.

---

## 3. Who it's for (audience & roles)

**Internal users** (work inside the private Google Sheet):

- **Admin** — **Nick** (Tango ED) and **Dev** (builder/maintainer). Full edit:
  add/qualify partners, toggle status, link partners to events, mark the primary
  partner, run reminders, rebuild the public view.
- **Chapter leader** — runs a single city's event. Receives the weekly reminder,
  forwards the partner a confirmation link, reads the partner's answer, decides if
  it's enough, and lines up backups. (In the current build, leaders mostly interact
  via **email**, not by editing the sheet directly.)
- **The data owner** — one named person who runs a short **monthly refresh** of the
  partner data. This role is a hard product requirement (see §17): if no one owns
  the data, the tool fails regardless of how well it's built.

**External audience** (read-only, the public map): Tango staff, leaders, and anyone
given the URL who wants the at-a-glance "who serves whom" picture. The public map
deliberately shows **no contact information** (see §6).

---

## 4. The two surfaces

The whole tool is **two surfaces over one set of partner data**:

1. **The private sheet — the back office.** A Google Sheets workbook named
   **`FTC Distribution (Partners)`**, separate from the public event-map workbook,
   with a **bound Apps Script** app (the `FTC` menu). This is where all the work
   happens and where all the sensitive data lives (contacts, agreements,
   `last_verified`). It never leaves this workbook.
2. **The public map — the display.** A single self-contained file,
   [`src/index.html`](../src/index.html), hosted on its **own Cloudflare Pages**
   project. It reads only the **published, non-contact** CSVs and shows event pins,
   active partner pins (colored by pathway), candidate pantries (gray, toggleable),
   and event→partner lines.

The bridge between them is the **`Rebuild public view`** action, which regenerates
two non-contact tabs (`Partners_Public`, `Links_Public`) that the human then
publishes to web as CSV.

---

## 5. Architecture & stack

- **Database:** Google Sheets, in a **separate workbook** from the public Events
  sheet. (This separation *is* the privacy wall.)
- **Admin app:** Google Apps Script via [`clasp`](https://github.com/google/clasp),
  bound to the workbook. All server logic is in
  [`apps-script/Code.gs`](../apps-script/Code.gs) (~2,500 lines); the UI is a set of
  HTML dialogs shown with `HtmlService` and `google.script.run`.
- **Public map:** one static HTML file on Cloudflare Pages, reading CSVs by URL with
  PapaParse and rendering with the Google Maps JavaScript API. No server, no auth, no
  Sheets API.
- **Join key:** `EventID` — the stable UUID the event map already assigns each event.
  It is the foreign key linking events to partners.
- **Geocoding:** Apps Script's **built-in keyless geocoder** (`Maps.newGeocoder()`),
  the same pattern the event map uses. Each partner address is geocoded **once** at
  creation; lat/long is cached in the sheet and **never** recomputed on map load.
- **Explicitly NOT used:** Supabase, Airtable, Salesforce. This is the "Tier A" build
  on the stack already proven by the event map. Do not introduce heavier infra.
- **Reference repo:** [`reference/feed-the-city-event-map/`](../reference/) is a
  **read-only** copy of the event map, kept for its Apps Script patterns. **Never
  modify it.**
- **Timezone:** `America/Chicago` (set in the manifest). All date math runs in this
  zone.

### Manifest / OAuth scopes (`apps-script/appsscript.json`)

| Scope | Why |
|---|---|
| `spreadsheets.currentonly` | Read/write the bound workbook only |
| `script.external_request` | `UrlFetchApp` — fetch the Events CSV + call the Places API |
| `script.container.ui` | Show the menu + HTML dialogs |
| `script.send_mail` | `MailApp` — leader reminder emails |
| `script.scriptapp` | Install/manage the form-submit + daily time triggers |
| `forms` | Create/read the reusable capacity Google Form |

---

## 6. The privacy wall (the most important rule)

**Rule #1 (from `AGENTS.md`):** the contact fields (`contact_name`, `contact_phone`,
`contact_email`), `agreement_on_file`, `agreement_date`, and `last_verified` are
**internal** and are **never** written to a published CSV or served on a public URL.

**The Phase 3b carve-out (decided 2026-06-19):** the team *deliberately* chose to
publish a **non-contact subset** of partner data to drive a public distribution map.
What is published, and only this, comes from the auto-generated `Partners_Public` /
`Links_Public` tabs:

- Published partner fields: `PartnerID`, `organization_name`, `city`, `address`,
  `latitude`, `longitude`, `pathway`, `cold_storage`, `monthly_capacity_meals`,
  `recurring_slot`, `partnership_status`.
- Published link fields: `PartnerID`, `EventID`, `active`.
- **Never published:** any contact field, `agreement_on_file`, `agreement_date`,
  `last_verified`, and (defense-in-depth) the per-link `recurring_slot` /
  `last_capacity_confirmed`.

**Mechanisms that enforce it:**

- The public tabs are generated by a fixed column list in code
  (`CONFIG.PUBLIC.PARTNERS.headers` / `CONFIG.PUBLIC.LINKS.headers`) — the sensitive
  columns are simply never copied across. To leak one you'd have to *add* it to that
  list, which is forbidden.
- The internal tabs (`Partners`, `EventPartnerLinks`, `Leaders`, `CapacityChecks`)
  live in a separate workbook and are never published.
- The public map (`src/index.html`) only parses the non-contact columns; even if a
  contact column somehow appeared in a CSV, the map wouldn't read it.

**One subtlety to know:** the `Events_Reference` mirror carries public event fields
including `Leader` (a chapter leader's **first name**) and `Time`/`Saturday`. These
are **already public** — the event map publishes them on its own Events sheet — so
mirroring them introduces no new exposure, and the map doesn't display the leader
name. Contact/agreement/verification data is partner data and is never here.

---

## 7. Food safety & legal compliance

This is a **real product requirement**, not a nicety. Texas rules treat two food
pathways differently, so the tool encodes the pathway as structured, required data.

- **`same-day`** — a shelter / soup kitchen that serves the food the same day.
  Covered by **Time as a Public Health Control**: cold food made at ≤41 °F and used
  within the time window. Easiest and most abundant.
- **`hold-redistribute`** — a partner with a fridge that distributes the food over
  the week. Governed by the **donation rule (TFER §228.64)**: the food must be
  **≤41 °F at the time of donation**, the donor must be able to **substantiate that
  the recipient has storage facilities**, and the food must be **labeled** (name,
  source, date of preparation).

Therefore **`cold_storage` is a legal prerequisite**, not a logistics note. The tool
encodes this as a hard validation gate:

> **The hold-and-redistribute pathway requires `cold_storage = yes`.** Add/Edit
> Partner rejects a save where `pathway = hold-redistribute` but `cold_storage ≠ yes`,
> with a message citing TFER §228.64.

Liability backdrop (informational): the **Bill Emerson Good Samaritan Act**,
strengthened by the **2023 Food Donation Improvement Act**, protects donations of
food that was safe and compliant **at handoff**. It rewards doing this right; it does
**not** excuse skipping the cold chain. The public map's info windows surface the
pathway and a compliance note for exactly this reason.

**The seeded-candidate carve-out:** rows seeded from Google Places (see §10) are
written with **blank** `pathway` and `cold_storage` because those facts are unknown
until a human qualifies the lead. They're unverified `candidate` rows and are **never
auto-promoted** to active. The required-fields gate is enforced at the point of
trust: **Edit Partner** won't save a candidate as anything usable until a valid
`pathway` + `cold_storage` are set.

---

## 8. The monthly cycle (how it's actually used)

This is the heartbeat of the tool. One line:

```
Nick assigns a primary partner → events auto-import (daily) → weekly leader reminder
→ leader forwards the partner a prefilled form → partner replies → leader reads the
number and decides → leader lines up backups (Find Nearby Pantries)
```

Step by step:

1. **Assign a primary.** In **Link Partner to Event(s)**, Nick links an active
   partner to an event and checks **Primary**. Exactly **one** partner per event is
   the primary (his first/default choice); the rest are backups. Marking a new
   primary automatically demotes any previous primary for that event.
2. **Auto-import events.** A **daily trigger** runs **Refresh Events**, pulling the
   public Events CSV into the read-only `Events_Reference` mirror (including each
   event's Saturday-of-month and leader first name). The manual menu item still works.
3. **Weekly leader reminder.** A **daily trigger** runs **`sendLeaderReminders`**
   (also available as **Send Reminders Now**). For every non-paused event whose next
   occurrence is within **7 days**, it:
   - resolves the **leader** (matches the event's `Leader` first name to the
     **Leaders** tab) and the **primary partner**;
   - upserts one `CapacityChecks` row (`Status='sent'`) for that primary partner +
     date;
   - emails the **leader** (never the partner) a reminder containing the event +
     date, the primary partner's contact, and a **ready-to-forward template** with
     the partner's **prefilled confirmation form link** embedded.
   - A per-(event, occurrence) **dedupe** ensures a leader isn't reminded twice for
     the same date. Events that can't be reminded (no primary, or no leader email)
     are reported and **retried** next run, not silently dropped.
4. **Partner confirms.** The leader forwards the message; the partner clicks the
   prefilled link, opens one reusable **Google Form**, answers Yes/No + a rough meal
   number, and submits. An installable form-submit trigger writes the answer back to
   the matching `CapacityChecks` row and stamps the link's `last_capacity_confirmed`.
5. **Leader decides.** The leader reads the confirmed number in **View Capacity
   Status**. **The app never predicts or judges meal counts** — it asks the partner
   their number, logs it, and shows it. There is no expected total and no shortfall.
6. **Backups on demand.** Any time (not gated on a shortfall), the leader uses
   **Find Nearby Pantries** to rank the nearest candidate + active partners to the
   event (excluding ones already linked), each with pathway, capacity, contact, and a
   one-click **prefilled backup form link** so they can reach out the same way.

Populating the universe (a prerequisite to step 6) is **Seed Pantries (Places)**,
typically run occasionally by an admin.

---

## 9. The data model — every tab, every column

There are **four internal tabs** (`Partners`, `EventPartnerLinks`, `Leaders`,
`CapacityChecks`), **one read-only mirror** (`Events_Reference`), and **two
auto-generated public tabs** (`Partners_Public`, `Links_Public`) — all in the private
Partners workbook. The header rows are written from `CONFIG` in `Code.gs` and **must**
match [`docs/DATA_MODEL.md`](DATA_MODEL.md) exactly; that file is the contract.

Conventions: **Req** = required for a valid record (enforced by the dialogs). All
"dropdown" columns are **reject-on-invalid** data-validation. "Checkbox" columns store
real booleans.

### Tab 1 — `Partners` (26 columns)

One row per distribution partner org. `PartnerID` is a UUID minted once. The address
is geocoded once → `latitude`/`longitude` cached.

| # | Column | Type | Req | Notes |
|---:|---|---|:--:|---|
| 1 | `PartnerID` | UUID | ✅ | Primary key. `Utilities.getUuid()`; never reused/edited. |
| 2 | `organization_name` | text | ✅ | HSDS `organization.name`. |
| 3 | `description` | text | | What the org does. |
| 4 | `website` | URL | | |
| 5 | `address` | text | ✅ | Geocoded once → lat/long. |
| 6 | `city` | text | | |
| 7 | `state` | text | | 2-letter (upper-cased on save). |
| 8 | `postal_code` | text | | Stored as text (preserve leading zeros). |
| 9 | `latitude` | number | | Cached geocode; never recomputed on load. |
| 10 | `longitude` | number | | Cached geocode. |
| 11 | `service_name` | text | | HSDS `service.name` (e.g. "Food pantry"). |
| 12 | `contact_name` | text | | **Internal — privacy wall.** |
| 13 | `contact_phone` | text | | **Internal — privacy wall.** (Places phone lands here.) |
| 14 | `contact_email` | text | | **Internal — privacy wall.** |
| 15 | `pathway` | enum | ✅ | Dropdown: `same-day` \| `hold-redistribute`. Legal gate. |
| 16 | `cold_storage` | enum | ✅ | Dropdown: `yes` \| `no`. Required for the hold pathway. |
| 17 | `monthly_capacity_meals` | number | | Roughly how many meals/month they can absorb. |
| 18 | `recurring_slot` | text | | e.g. "2nd Saturday" — the org's standing cadence. |
| 19 | `partnership_status` | enum | | Dropdown: `candidate` \| `active` \| `paused`. |
| 20 | `assigned_chapter` | text | | FTC chapter that owns the relationship. |
| 21 | `agreement_on_file` | bool | | Checkbox. **Internal.** |
| 22 | `agreement_date` | date | | **Internal.** |
| 23 | `last_verified` | date | | **Internal & the single most important field** (§17). Set to now on add; refreshed on every Edit save. Blank for seeded candidates. |
| 24 | `FirstAdded` | date | | **System / immutable.** Stamped once on add; Edit never changes it. |
| 25 | `source` | text | | `places` for Places-seeded rows; blank for hand-added. Preserved by Edit. |
| 26 | `hours` | text | | Opening hours; Places `weekdayDescriptions` joined with `; `. Preserved by Edit. |

**Dropdown allowed values:** `pathway` → `same-day`, `hold-redistribute`;
`cold_storage` → `yes`, `no`; `partnership_status` → `candidate`, `active`, `paused`.
**Checkbox columns:** `agreement_on_file`.

### Tab 2 — `EventPartnerLinks` (7 columns)

The **many-to-many** join: one event → many partners; one partner → many events.
`(EventID, PartnerID)` is unique — the Link dialog **upserts** (updates the existing
row rather than duplicating).

| # | Column | Type | Req | Notes |
|---:|---|---|:--:|---|
| 1 | `LinkID` | UUID | ✅ | Primary key for the link row. |
| 2 | `EventID` | UUID | ✅ | FK → Events (`EventID`). |
| 3 | `PartnerID` | UUID | ✅ | FK → `Partners.PartnerID`. |
| 4 | `active` | bool | ✅ | Checkbox. Is this link currently live? |
| 5 | `recurring_slot` | text | | Per-link cadence (may differ from the partner's default). |
| 6 | `last_capacity_confirmed` | date | | Stamped when the partner confirms via the form. |
| 7 | `is_primary` | bool | | Checkbox. Exactly **one** primary per `EventID`; the Link dialog enforces it by demoting others. |

### Tab 3 — `Leaders` (5 columns)

Chapter leaders. **No id column / no auto-UUID** (the email is the natural key).
Internal-only; never published.

| # | Column | Type | Req | Notes |
|---:|---|---|:--:|---|
| 1 | `leader_name` | text | ✅ | Full name. The resolver matches on the **first name**, so `"Blaine Carter"` matches an event whose `Leader = "Blaine"`. |
| 2 | `leader_email` | text | ✅ | Where the reminder goes. A match with no email is flagged, not emailed. |
| 3 | `chapter` | text | | Which FTC chapter they lead. |
| 4 | `active` | bool | | Checkbox. Active matches are preferred on a first-name tie. |
| 5 | `notes` | text | | Free text. |

### Tab 4 — `Events_Reference` (12 columns, read-only mirror)

A **read-only mirror** of the public event-map Events sheet. Populated by **Refresh
Events** (menu) **and a daily trigger**. Every refresh fetches the public Events CSV,
clears the data rows, and rewrites them (deduped by `EventID`; rows without an
`EventID` are skipped). It holds **no partner data** — every column is a public event
field — and carries a warning-only protection so it isn't hand-edited.

| # | Column | Source | Notes |
|---:|---|---|---|
| 1 | `EventID` | `EventID` | Join key → `EventPartnerLinks.EventID`. |
| 2 | `City` | `City` | Display. |
| 3 | `State` | `State` | Display. |
| 4 | `Venue` | `Venue` | "City — Venue" label. |
| 5 | `Address` | `Address` | Map pins / lines. |
| 6 | `Saturday` | `Saturday` | First/Second/Third/Fourth/Fifth/Last — drives the next-date math. |
| 7 | `Time` | `Time` | Shown in the reminder email. |
| 8 | `Leader` | `Leader` | Chapter-leader first name → matched to the Leaders tab. |
| 9 | `Status` | `Status` | e.g. "Live". |
| 10 | `Paused` | `Paused` | `Yes`/`No` — paused events are skipped by reminders. |
| 11 | `Latitude` | `Latitude` | Cached geocode (from the event map). |
| 12 | `Longitude` | `Longitude` | Cached geocode. |

### Tab 5 — `CapacityChecks` (9 columns)

The pre-event confirmation log. One row per (event, date, partner) ask. Rows are
**created** by the leader-reminder paths (`sendLeaderReminders` / `runCapacityCheck` /
`getBackupReminderLink` — all via `upsertCapacityCheck_`, all `Status='sent'`) and
**updated** by the form-submit trigger. Internal-only.

| # | Column | Type | Notes |
|---:|---|---|---|
| 1 | `CheckID` | UUID | Primary key + the reference code prefilled into the partner's form link. |
| 2 | `EventID` | UUID | FK → Events. |
| 3 | `PartnerID` | UUID | FK → Partners. |
| 4 | `EventDate` | `YYYY-MM-DD` | The upcoming distribution date this ask is for. Part of the upsert key. |
| 5 | `RequestedMeals` | number | **Legacy / always blank.** Kept for back-compat; there is no expected total. |
| 6 | `ConfirmedMeals` | number | The partner's own number from their reply (0 if they said yes without one, or declined). |
| 7 | `Status` | enum | Dropdown: `sent` \| `confirmed` \| `declined` \| `no-response`. |
| 8 | `SentTimestamp` | datetime | When the ask went out (refreshed on each re-send). |
| 9 | `ResponseTimestamp` | datetime | When the partner submitted (preserved across re-sends). |

### Tabs 6 & 7 — `Partners_Public` (11) / `Links_Public` (3)

Auto-generated by **Rebuild public view**, navy-styled (visually "this one is
published"), warning-only protected, fully rewritten each run. The non-contact subset
only (see §6). `Links_Public` only emits links whose partner is in `Partners_Public`
**and** whose event still exists in `Events_Reference`.

- `Partners_Public`: `PartnerID`, `organization_name`, `city`, `address`, `latitude`,
  `longitude`, `pathway`, `cold_storage`, `monthly_capacity_meals`, `recurring_slot`,
  `partnership_status`.
- `Links_Public`: `PartnerID`, `EventID`, `active`.

### Reference — `Events` (event-map workbook, READ-ONLY, not owned here)

The tool joins to it by `EventID` but never writes it. Sample columns are in
[`reference/events-sample.csv`](../reference/events-sample.csv):
`City, State, Venue, Address, Saturday, Time, Leader, EventPageURL, GoogleMapsURL,
Paused, Latitude, Longitude, Status, Last Updated, Notes, EventID, FirstAdded,
PhotoURL`.

### UUID generation (`onEdit`)

A simple `onEdit` trigger watches `Partners`, `EventPartnerLinks`, and
`CapacityChecks`. When a row below the header gains **real content** in a non-id
column and its id cell is blank, it stamps a fresh `Utilities.getUuid()`. A
**ghost-row guard** means a stray edit in an otherwise-empty row never mints an
orphan id. `Leaders` has no id column, so `onEdit` leaves it alone.

---

## 10. The `FTC` menu — every action

The menu is built by `onOpen`. Top to bottom:

| Menu item | Function | What it does |
|---|---|---|
| **Add Partner** | `openAddPartnerDialog` → `addPartner` | Qualify-and-geocode form. Validates required food-safety fields, mints `PartnerID`, geocodes once, defaults status to `candidate`, stamps `FirstAdded` + `last_verified`. |
| **Edit Partner** | `openEditPartnerDialog` → `updatePartner` | Edit the selected (or a given) Partners row. Refreshes `last_verified` on every save; re-geocodes **only** if the address changed; preserves `PartnerID`, `FirstAdded`, `source`, `hours`. This is the qualification gate that requires a valid `pathway` + `cold_storage`. |
| **Refresh Events** | `refreshEvents` | Mirror the public Events CSV into `Events_Reference` (deduped, read-only). Also runs daily on a trigger. |
| **Link Partner to Event(s)** | `openLinkPartnerDialog` → `linkPartnerToEvents` | Pick one partner, multi-select events, set `active` / `recurring_slot` / **Primary**. Upserts links; if Primary is checked, demotes any other primary on those events. |
| **View Links** | `openViewLinksDialog` → `getLinksForPartner` / `getLinksForEvent` | Both directions of the join, with active/primary/stale badges. |
| **Send Reminders Now** | `sendLeaderReminders` | Run the weekly leader-reminder batch immediately (same function the daily trigger runs). Shows a summary alert. |
| **Send Reminder for One Event…** | `openRunCapacityCheckDialog` → `runCapacityCheck` | Send a leader reminder for one chosen event on demand (forced even if already reminded). Shows the resolved leader + primary partner. |
| **View Capacity Status** | `openViewCapacityStatusDialog` → `getCapacityStatusData` / `getCapacityStatus` | Per (event, date): each partner's response and the confirmed-meals total. No expected total, no shortfall. |
| **Find Nearby Pantries** | `openFindPantriesDialog` → `getFindPantriesData` / `findNearbyPantries` / `getBackupReminderLink` | Rank the nearest candidate + active partners to an event (excluding linked ones); each with distance, pathway, cold storage, capacity, contact, and an on-demand **backup form link**. |
| **Seed Pantries (Places)** | `seedPantries` | For each geocoded event, query Google Places for pantries/banks/soup kitchens, write the nearest ~20 as `candidate` rows. Resumable + deduped. |
| **Rebuild public view** | `rebuildPublicView` | Regenerate `Partners_Public` / `Links_Public` (non-contact subset) for publishing. |
| **Set up sheets** | `setupSheets` | One-time setup/repair: build all tabs (headers, dropdowns, checkboxes, validation), install the two daily triggers. Idempotent. |

---

## 11. Deep dives on the tricky logic

### 11.1 Add / Edit Partner & geocoding

- `normalizePartnerDraft_` cleans the form payload (trims, upper-cases state, coerces
  `agreement_on_file` to a real boolean).
- `validatePartnerDraft_` enforces, server-side: organization name + address present;
  a valid `pathway`; a valid `cold_storage`; and the **legal gate** — if
  `pathway = hold-redistribute` then `cold_storage` must be `yes`. Errors are thrown
  back to the dialog.
- `fillPartnerCoordinates_` geocodes via `Maps.newGeocoder().setRegion('us')` **only**
  when valid lat/long aren't already present ("skip if already present"). A failed
  geocode is non-fatal — the row saves without a pin and the dialog reports it.
- `updatePartner` re-geocodes **only** when the normalized address signature
  (`address|city|state|postal_code`, lowercased) changed; otherwise the cached coords
  carry over untouched. `PartnerID` and `FirstAdded` are read back from the stored row
  so the form can't blank them; `source` / `hours` are preserved.
- `validLatLng_` treats coordinates as valid only when finite, in range, and not the
  null island (0,0).

### 11.2 Linking & the primary-partner invariant

`linkPartnerToEvents` indexes existing links by `PartnerID|EventID` and upserts one
row per selected event. When **Primary** is checked, after writing this partner's
link as primary it iterates every other partner's link on those same events and sets
`is_primary = false` — guaranteeing **at most one primary per event**. The dialog
resets the Primary checkbox after each save so it isn't sticky for the next batch.

### 11.3 The resolver (`resolveEventLeaderAndPrimary`)

Given an `EventID`, it returns the event's **leader** and **primary partner**:

- **Leader** (`resolveEventLeader_`): matches the event's `Leader` first name to a
  `Leaders` row (whole-name or first-name match), preferring an **active** row. It
  always returns a `flag` string when the leader can't be cleanly emailed — no leader
  name on the event, no matching Leaders row, matched row with no email, matched row
  inactive, or an ambiguous first-name match (two leaders named "Blaine"). The
  reminder workflow surfaces these flags instead of failing silently.
- **Primary** (`resolveEventPrimaryPartner_`): the link with `is_primary = TRUE`,
  joined to its Partners row, carrying the internal contact fields (shown to leaders,
  never published). Returns `null` if no primary is set.

### 11.4 The Saturday-of-month date math (the fiddly part)

Events recur on a fixed Saturday of the month (`First`…`Fifth`/`Last`).
`nextEventOccurrence_(saturdayField, fromDate)`:

- `parseSaturdayOrdinal_` maps the field to `1..5` or `'last'` (also accepts
  `1st`…`5th` or a bare digit); unrecognized → `null`.
- `nthSaturdayOfMonth_` computes the date of the Nth Saturday, returning `null` if
  that month has **no** Nth Saturday (e.g. no 5th Saturday).
- `lastSaturdayOfMonth_` computes the last Saturday.
- The function walks **this month and forward up to 14 months**, returning the first
  occurrence on or after `fromDate`. This correctly: rolls to next month when this
  month's Saturday already passed, and **skips months with no Nth Saturday** (a
  5th-Saturday event lands on the next month that actually has a 5th Saturday).

Verified by unit test against 2026 dates: from 2026-06-19, `Third` → 2026-06-20
(in-window), `Fifth` → 2026-08-29 (June and July have no 5th Saturday), `Last` →
2026-06-27; from 2026-06-25 (after the 3rd Saturday), `Third` → 2026-07-18.
**Assumption (documented):** the `Saturday` field is one of First/Second/Third/
Fourth/Fifth/Last and events recur monthly on that Saturday.

### 11.5 The reminder window & dedupe

- **Window:** an event is reminded when its next occurrence is `0–7` days out
  (`REMINDER_LEAD_DAYS = 7`). The daily trigger catches it the first day it enters
  that window (≈7 days before); if a day is missed, any later day in the window still
  sends it once.
- **Dedupe:** keyed by `EventID|YYYY-MM-DD` in a `ScriptProperties` JSON map
  (`LEADER_REMINDERS_SENT`). Past-dated keys are pruned each run so the store stays
  small. The single-event "forced" path records the same marker so the daily batch
  won't re-send.
- **Resilience:** events that can't be reminded (no primary, or no leader email) are
  **not** deduped — they're reported and retried next run once the data is fixed.

### 11.6 The capacity Google Form & response routing

- **One reusable form** is created lazily on first use (`ensureCapacityForm_`) and its
  id + the three item ids + published URL are cached in `DocumentProperties`. Items: a
  short-text "Reference code" (the `CheckID`, prefilled — "please don't edit"), a
  Yes/No multiple choice, and a meals count.
- **Prefilled links** (`capacityPrefilledUrl_`) embed the `CheckID` so each partner's
  reply routes back to the right `CapacityChecks` row, keyed effectively by
  `EventID + PartnerID + EventDate`.
- **`onCapacityFormSubmit`** (installable trigger) reads the `CheckID` + Yes/No +
  meals, writes `Status` (`confirmed`/`declined`), `ConfirmedMeals` (the partner's own
  number, parsed inline; 0 if yes-without-a-number or declined), and
  `ResponseTimestamp`; on a "yes" it stamps the link's `last_capacity_confirmed`. The
  trigger is kept unique and re-pointed if the form is ever recreated.
- **Re-send safety:** `upsertCapacityCheck_` preserves an existing response — it only
  refreshes `SentTimestamp`, never wiping a partner's already-submitted answer.

### 11.7 Find Nearby Pantries & backup links

`nearestPartnersForEvent_` ranks the full `candidate + active` universe (paused
excluded) that isn't already linked to the event, by **great-circle distance**
(haversine) when both have coordinates, or **by capacity** when the event has no
coordinates (the dialog says which). Capped at `FIND_PANTRIES_LIMIT = 20`. Each item
carries the internal contact fields (leader-only). The **Get backup form link** button
calls `getBackupReminderLink`, which upserts a `CapacityChecks` row for that backup +
the event's next date **on demand** (not eagerly for all 20, so browsing never mints
20 rows) and returns the prefilled URL + a copyable forward template.

### 11.8 Seed Pantries (Google Places)

- For each **geocoded** event in `Events_Reference`, runs three Places **Text Search**
  queries (`food pantry`, `food bank`, `soup kitchen`) biased to a circle of the
  configured radius (default **15 mi**), merges + dedupes by place id, ranks by
  distance, and keeps the nearest **20** (default).
- Writes them as `partnership_status = candidate`, `source = places`, **blank**
  `last_verified` / `pathway` / `cold_storage`, with name, address, geocoded lat/long
  (from Places), phone (→ `contact_phone`), and hours. **Never auto-promoted.**
- **Dedup** (`isDuplicatePartner_` + `normalizeName_`): a place is skipped if an
  existing partner shares its normalized name **and** is within **0.1 mi** (or shares
  the name when coordinates are missing). The in-run signature set also stops the same
  pantry near two events being added twice — so the ~50 real active partners are never
  re-added as candidates.
- **Key:** a **separate server-side** key in the `PLACES_API_KEY` Script Property
  (sent in the `X-Goog-Api-Key` header), **not** the map's referrer-restricted browser
  key. A field mask limits the response (and billing) to the fields stored.
- **Resumable + time-bounded:** processes events until a ~4.5-minute budget
  (`PLACES_TIME_BUDGET_MS`), flushes everything in **one batched `setValues`**
  (`appendPartnerRowsBatched_`), and records finished events in a Script Property
  (`PLACES_SEEDED_EVENTS`) so a large run continues on re-run; the cursor clears when
  all events are done. This keeps it under Apps Script's ~6-minute execution cap.

### 11.9 Rebuild public view

`rebuildPublicView` maps `Partners` → the non-contact subset and `EventPartnerLinks` →
`PartnerID/EventID/active` (normalizing `active` to a real TRUE/FALSE), dropping links
whose partner isn't published or whose event isn't in the mirror. Both tabs are fully
rewritten, navy-styled, and warning-only protected. The human then publishes each to
web as CSV.

---

## 12. The public distribution map

A single file, [`src/index.html`](../src/index.html), on its own Cloudflare Pages
project. No build step, no framework — PapaParse + the Google Maps JS API.

**What it draws:**

- **Event pins** — navy teardrop (gray when paused), the same silhouette as the event
  map so the two read as a family.
- **Partner pins** — flat discs. **Active** partners are **colored by pathway**:
  orange (`same-day`) / teal (`hold-redistribute`). **Candidate** pantries are **gray**
  with a dashed ring (an "unverified" cue). **Paused** are gray + dimmed.
- **Lines** — from each event to every partner it's linked to: solid navy for active
  links, dashed gray for inactive.
- **Selection** — clicking a pin highlights its connected lines in orange, emphasizes
  the markers at the other ends, and opens an info window. The partner info window
  shows pathway, cold storage, capacity, recurring slot, status, a **compliance note**
  (hold pathway warns if cold storage isn't yes; same-day notes the time-control
  rule), and the list of linked events. The event info window lists its receiving
  partners.

**The candidate toggle (legend):** a **Show candidate pantries** checkbox (on by
default) hides/shows the gray candidate pins **and their connecting lines**; the count
badge tracks what's visible.

**Data:** reads three published CSVs configured in `CONFIG` — `PARTNERS_CSV`
(`Partners_Public`), `LINKS_CSV` (`Links_Public`), and `EVENTS_CSV` (defaults to the
event map's already-published Events CSV, so no extra publish step; you can point it at
this workbook's published `Events_Reference` instead). Auto-refreshes every 10 minutes;
a manual **Refresh** button too. If the CSV URLs are still placeholders it shows a
setup message.

**Maps API key:** same pattern as the event map. A **referrer-restricted** Maps JS key
is committed in `FALLBACK_KEY` (a Maps JS key is client-side and visible in every
visitor's browser anyway — the real protection is the **HTTP referrer restriction**
locked to this site's URL, not secrecy). `?k=YOUR_KEY` in the URL overrides it for
local testing. The key must allow this site's `*.pages.dev` referrer and have the Maps
JavaScript API enabled; **no Geocoding at runtime** (coordinates are cached). If the
key is missing/invalid, `gm_authFailure` shows a clear setup card; an 8-second
watchdog catches a never-loading Maps script.

**Branding:** orange `#FF6500`, navy `#003366`, teal accent `#0E7C7B` for the hold
pathway, gray for paused/candidate.

---

## 13. Automation — triggers & background jobs

| Trigger | Type | Handler | What it does |
|---|---|---|---|
| `onOpen` | simple | `onOpen` | Builds the `FTC` menu. Cannot create installable triggers (no auth). |
| `onEdit` | simple | `onEdit` | Auto-fills UUID ids on `Partners`/`EventPartnerLinks`/`CapacityChecks`, with the ghost-row guard. |
| Form submit | installable | `onCapacityFormSubmit` | Routes a form reply back to its `CapacityChecks` row + stamps the link. Installed lazily with the form (`ensureCapacityFormTrigger_`). |
| Refresh Events | installable, **daily ~05:00** | `refreshEvents` | Keeps `Events_Reference` current. Installed by `ensureRefreshTrigger_`. |
| Leader reminders | installable, **daily ~07:00** | `sendLeaderReminders` | Sends the weekly leader reminders. Installed by `ensureReminderTrigger_`. |

The two daily triggers are installed/repaired by **Set up sheets** (`ensureRefreshTrigger_`
+ `ensureReminderTrigger_`), each idempotent (it won't create a duplicate). They run at
05:00 and 07:00 so events are fresh before reminders go out.

**UI-safety:** functions that run **both** from the menu and from a time-trigger must
not call `SpreadsheetApp.getUi()` unconditionally (it throws in trigger context).
`refreshEvents` does its work first and only shows dialogs if a UI is available (a
failed trigger run surfaces in the execution log). `sendLeaderReminders` wraps its
summary alert in try/catch for the same reason.

---

## 14. Configuration & stored state

**You must fill / set:**

- **Leaders tab** — one row per chapter leader (name, email, chapter, active).
- **Primary partner** — the **Primary** checkbox on one link per event (Link dialog).
- **`PLACES_API_KEY`** — Script Property (Apps Script ▸ Project Settings ▸ Script
  Properties): a server-side Google Places API (New) key, restricted to the Places API
  (**not** referrer-locked). Optional overrides: `PLACES_RADIUS_MILES` (default 15),
  `PLACES_MAX_PER_EVENT` (default 20).
- **Published CSV URLs** — paste `Partners_Public`, `Links_Public`, and
  `Events_Reference` published-to-web CSV URLs into `CONFIG` in `src/index.html`.
- **Maps JS key** — `FALLBACK_KEY` in `src/index.html` (referrer-restricted), with this
  site's `*.pages.dev` added to its allowed referrers.

**`ScriptProperties` keys:** `PLACES_API_KEY`, `PLACES_RADIUS_MILES`,
`PLACES_MAX_PER_EVENT`, `PLACES_SEEDED_EVENTS` (resume cursor),
`LEADER_REMINDERS_SENT` (reminder dedupe map).

**`DocumentProperties` keys (capacity form):** `CAPACITY_FORM_ID`,
`CAPACITY_FORM_PUBLISHED_URL`, `CAPACITY_ITEM_CHECKID`, `CAPACITY_ITEM_YESNO`,
`CAPACITY_ITEM_MEALS`.

**Key constants in `Code.gs`:** `EVENTS_CSV_URL` (the public Events CSV to mirror),
`REMINDER_LEAD_DAYS = 7`, `REMINDER_TRIGGER_HOUR = 7`, `REFRESH_TRIGGER_HOUR = 5`,
`FIND_PANTRIES_LIMIT = 20`, `PLACES_DEFAULTS` (15 mi / 20), `PLACES_TIME_BUDGET_MS`
(270000), `PLACES_QUERIES` (food pantry / food bank / soup kitchen),
`PLACES_DUP_MILES` (0.1), brand `COLORS`.

**Gitignored (per clone):** `apps-script/.clasp.json` (your `scriptId`),
`.clasprc.json` (clasp credentials). `apps-script/.clasp.json.example` shows the shape.

---

## 15. Setup & deployment, end to end

1. **Git hooks (auto-push):** `git config core.hooksPath .githooks` — a tracked
   `post-commit` hook auto-pushes to `origin/main`, so committing is enough.
2. **clasp:** `npm i -g @google/clasp` → `clasp login` → `cd apps-script` →
   `clasp clone <scriptId>` → `clasp push`.
3. **Set up sheets:** in the workbook, **FTC ▸ Set up sheets**. Approve the auth prompt
   (it needs the ScriptApp scope to install triggers). This builds all tabs and the two
   daily triggers.
4. **Fill Leaders** and mark a **Primary** partner per event.
5. **Places key:** add `PLACES_API_KEY` (and optional overrides) in Script Properties;
   run **Seed Pantries (Places)** to populate candidates.
6. **Public map:** **Rebuild public view** → publish `Partners_Public`,
   `Links_Public`, (optionally) `Events_Reference` to web as CSV → paste the URLs into
   `src/index.html` `CONFIG` → deploy `src/` to Cloudflare Pages → add the site's
   `*.pages.dev` to the Maps key's referrers. Full guide: [`docs/PUBLIC_MAP.md`](PUBLIC_MAP.md).
7. **Verify:** run [`docs/SMOKE_TEST.md`](SMOKE_TEST.md).

**Contributing workflow:** small reviewable steps; smoke-test after each; stage all,
commit with a conventional message (`feat:`/`fix:`/`docs:`), let the post-commit hook
push; keep `CHANGELOG.md` current.

---

## 16. Function reference (Apps Script)

Grouped by area. `_`-suffixed names are private helpers.

**Menu / setup:** `onOpen`, `setupSheets`, `setupOneSheet_`, `removeDefaultSheetIfEmpty_`.

**Add/Edit Partner:** `openAddPartnerDialog`, `addPartner`, `openEditPartnerDialog`,
`updatePartner`, `getPartnerForEdit`, `normalizePartnerDraft_`, `validatePartnerDraft_`,
`partnerAddressSig_`, `partnerGeocodeQuery_`, `fillPartnerCoordinates_`, `validLatLng_`,
`readPartnerRow_`, `writePartnerRow_`, `applyPartnerRowValidation_`,
`ensurePartnerHeaders_`, `getActivePartnerRow_`.

**Events mirror:** `refreshEvents`, `fetchEventsCsv_`, `setupEventsReferenceSheet_`,
`readEventsReference_`, `ensureRefreshTrigger_`.

**Links:** `openLinkPartnerDialog`, `linkPartnerToEvents`, `openViewLinksDialog`,
`getLinkDialogData`, `getLinksForPartner`, `getLinksForEvent`, `readAllLinks_`,
`writeLinkRow_`, `ensureLinkHeaders_`, `linkLabelSort_`.

**Leaders / resolver:** `readAllLeaders_`, `resolveEventLeader_`,
`resolveEventPrimaryPartner_`, `resolveEventLeaderAndPrimary`.

**Leader reminders:** `sendLeaderReminders`, `formatReminderSummary_`,
`runLeaderReminders_`, `remindLeaderForEvent_`, `upsertCapacityCheck_`,
`sendLeaderReminderEmail_`, `buildPartnerFormTemplate_`, `runCapacityCheck`,
`getRunCapacityCheckData`, `getLeaderReminderPreview`, `ensureReminderTrigger_`.
Date math: `todayLocal_`, `ymdLocal_`, `dayDiff_`, `parseSaturdayOrdinal_`,
`nthSaturdayOfMonth_`, `lastSaturdayOfMonth_`, `nextEventOccurrence_`. Dedupe:
`getRemindersSent_`, `saveRemindersSent_`, `pruneRemindersSent_`.

**Capacity form / status:** `ensureCapacityForm_`, `ensureCapacityFormTrigger_`,
`capacityPrefilledUrl_`, `onCapacityFormSubmit`, `touchLinkCapacityConfirmed_`,
`openViewCapacityStatusDialog`, `getCapacityStatusData`, `getCapacityStatus`,
`readAllCapacityChecks_`, `writeCapacityRow_`, `ensureCapacityHeaders_`.

**Find Nearby Pantries:** `openFindPantriesDialog`, `getFindPantriesData`,
`findNearbyPantries`, `nearestPartnersForEvent_`, `getBackupReminderLink`,
`haversineMiles_`.

**Seed Pantries:** `seedPantries`, `parseIdSet_`, `appendPartnerRowsBatched_`,
`placesNearbyPantries_`, `placesTextSearch_`, `parsePlace_`, `parseUsAddress_`,
`serviceNameFromTypes_`, `placeToPartnerDraft_`, `normalizeName_`, `isDuplicatePartner_`.

**Public view:** `rebuildPublicView`, `writePublicSheet_`.

**Shared utilities:** `onEdit`, `rowHasUserContent_`, `readAllPartners_`,
`readAllRows_`, `headerMap_`, `headerMapFromSpec_`, `sheetSpecByName_`,
`getOrCreateSheet_`, `withLock_`, `isTruthyFlag_`, `eventLabel_`, `partnerLocation_`,
`ymd_`, `formatTs_`, `escHtml_`.

**HTML dialogs:** `AddPartnerDialog`, `EditPartnerDialog`, `LinkPartnerDialog`,
`ViewLinksDialog`, `RunCapacityCheckDialog`, `ViewCapacityStatusDialog`,
`FindPantriesDialog`.

---

## 17. Design principles & invariants

- **The app never predicts or judges meal counts.** It asks the partner their number,
  logs it, and shows it. No expected total, no deficit, no shortfall, no adequacy
  judgment. The leader decides. (`RequestedMeals` is a legacy, always-blank column.)
- **The system reminds leaders, never partners.** Partners are only ever contacted by
  a human (the leader) forwarding a prefilled link.
- **Exactly one primary partner per event.** Enforced by the Link dialog's demotion
  pass.
- **`pathway` + `cold_storage` are required and legally meaningful.** The hold pathway
  requires `cold_storage = yes`. Seeded candidates may carry them blank but can't be
  activated/relied on until Edit Partner sets valid values.
- **Geocode once.** Cache lat/long; never re-geocode on map load; re-geocode only on
  an address change.
- **`last_verified` is the make-or-break field.** Stale data kills tools like this, so
  one named owner runs a monthly refresh and `last_verified` is visible on every
  record. This is a hard requirement, not a nice-to-have.
- **Many-to-many via the link table** — never a single partner column on an event.
- **The privacy wall** (§6) — partner contact/agreement/verification data is never
  published.
- **Reuse the event map's proven patterns** (menu, `headerMap_`, `withLock_`,
  geocoding, status) — don't reinvent them, don't modify the map repo.
- **Thin shell over good data** — the value is the partner data + the compliance field,
  not the UI. Don't over-build.

---

## 18. Nuances, edge cases & gotchas

- **`google.script.run` can't serialize `Date` objects.** Server functions that feed
  dialogs `String()`-ify dates (`getPartnerForEdit`, `getCapacityStatus`, etc.).
- **`LockService` isn't reentrant.** `withLock_` guards read-then-write races;
  helpers called from inside a lock (e.g. `touchLinkCapacityConfirmed_`) must not take
  it again. Reminder emails are sent **outside** the lock.
- **Warning-only protections** on `Events_Reference`, `Partners_Public`,
  `Links_Public` nudge humans not to hand-edit, while letting script writes pass
  through.
- **`ensure*Headers_`** functions append any missing schema column to an older sheet
  so a save never lands in a sheet that predates a column (e.g. `FirstAdded`,
  `is_primary`).
- **Batched writes** in Seed Pantries (`appendPartnerRowsBatched_`) replaced per-row
  writes that blew the ~6-minute execution cap.
- **Date math runs in `America/Chicago`** (manifest timezone). Day differences are
  rounded to absorb DST's 23/25-hour days.
- **Ambiguous leader first names** (two "Blaine"s) are matched best-effort (active
  first) and **flagged** — fix on the Leaders tab if wrong.
- **An event with no coordinates** still gets reminders (reminders don't need coords),
  but Find Nearby Pantries ranks by capacity instead of distance, and Seed Pantries
  skips it.
- **Re-running a reminder** never wipes a partner's submitted answer
  (`upsertCapacityCheck_` preserves it).
- **The map lists candidate partners in an event's info window even when the gray pins
  are toggled off** — the toggle declutters the map, it isn't a data filter.
- **The committed Maps key is intentional** — a Maps JS key is client-side and visible
  anyway; the protection is the HTTP-referrer restriction, not secrecy.

---

## 19. What is NOT built

- **The private gated web app** (PRD §4) — an Apps Script `doGet` web app gated by
  Google sign-in that would render the **full internal** map (contacts included) in a
  browser. It remains the planned model for the full internal view; no `doGet` exists
  yet. The internal "map" today is the data in the sheet plus the dialogs; the only
  *map* UI is the **public** (non-contact) one.
- **Leaders editing the sheet directly / role-based sheet permissions.** Leaders are
  served by **email** in the current build; PRD §9 describes Admin/Leader/Read-only
  roles as the intent, but Google-Sheets-level per-leader scoping isn't implemented.
- **A 211 / Open Referral (HSDS) feed importer.** The schema is HSDS-shaped and the
  PRD mentions 211 as a possible source, but only Google Places seeding is built.
- **Any real-time "claim-a-slot" marketplace** — explicitly out of scope; the cadence
  is predictable and standing relationships fit better.

---

## 20. Project history (phases)

- **Phase 1 — Scaffold:** repo, stub files, clasp project, git remote + auto-push hook.
- **Phase 2a — Data foundation:** `Set up sheets` builds `Partners` /
  `EventPartnerLinks` with headers, dropdowns, checkboxes, auto-UUID.
- **Phase 2b — Add/Edit Partner + geocoding:** the qualify-and-geocode dialogs, the
  food-safety gate, `FirstAdded`/`last_verified`.
- **Phase 3a — Links + events mirror:** `Refresh Events`, `Link Partner to Event(s)`,
  `View Links`, the many-to-many join.
- **Phase 3b — Public map:** `Rebuild public view`, the non-contact public tabs, and
  `src/index.html` on Cloudflare Pages (the scoped privacy-wall carve-out).
- **Phase 4 — Capacity check:** the reusable Google Form + response routing to
  `CapacityChecks`.
- **Phase 5 — Pantry universe + leader-triggered backups:** `Seed Pantries (Places)`,
  `Find Nearby Pantries`, and the removal of expected-total/shortfall judgment.
- **Finish-the-app build:** `Leaders` tab + per-event **primary** partner; the capacity
  check became a **weekly leader-reminder** workflow (no direct partner emails); daily
  **auto-triggers** for Refresh Events + reminders; a **prefilled backup form link** in
  Find Nearby Pantries; the public map's **gray candidate pins + show/hide toggle**;
  and the removal of the last prediction symbol (`parseMeals_`). See `CHANGELOG.md`.

---

## 21. Glossary

- **Event** — a Feed the City cooking event (where food is *made*); owned by the public
  event map; identified by a stable `EventID` UUID.
- **Partner** — an org that *receives* the food (pantry, food bank, soup kitchen,
  shelter).
- **Candidate / Active / Paused** — partnership status. Candidates are unverified leads
  (often Places-seeded); actives are confirmed and usable; paused are temporarily out.
- **Primary partner** — the one default partner per event; the rest are backups.
- **Leader** — the chapter leader running a city's event; receives the weekly reminder.
- **Pathway** — `same-day` vs `hold-redistribute`; a legal classification, not just
  logistics.
- **Capacity check** — the pre-event confirmation that a partner can take this cycle's
  food, logged in `CapacityChecks`.
- **The privacy wall** — the rule that contact/agreement/verification data is never
  published.
- **The mirror** — `Events_Reference`, the read-only local copy of the public Events
  sheet.
- **The public view** — the auto-generated `Partners_Public` / `Links_Public` tabs and
  the Cloudflare map that reads them.

---

## 22. What can't be verified without Google

Everything that depends on the Google runtime must be checked by a human in a real
account (see [`docs/SMOKE_TEST.md`](SMOKE_TEST.md)): trigger installation, sending and
rendering the leader email, the prefilled-link → `CapacityChecks` round-trip, the live
Places API + dedup + geocoding, and the published-CSV → Cloudflare map rendering in a
browser with a real Maps key. What *can* be checked statically — and has been — is JS
syntax, the Saturday-of-month date math (unit-tested against known 2026 dates), the
map's inline-script syntax, cross-file function references, and the privacy-wall column
sets. Treat the smoke test as the source of truth for "does it actually work."
