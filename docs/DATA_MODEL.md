# Data Model

Column-by-column schema for the FTC Distribution Tool. Adopts the HSDS
("Open Referral") shape so the data is standard and portable. Expands `PRD.md`
§5; see `AGENTS.md` for the hard rules.

**This file is the contract.** The header rows written by the Apps Script
`Set up sheets` function (`apps-script/Code.gs`, `CONFIG.PARTNER_HEADERS` /
`CONFIG.LINK_HEADERS`) MUST match the column names below, in this exact order.
Change one, change the other.

Three internal data tabs (`Partners`, `EventPartnerLinks`, `CapacityChecks`)
live in the **Partners workbook** — a *separate* Google Sheets workbook
(`FTC Distribution (Partners)`) from the public event-map Events sheet. That
separation is the privacy wall. A fourth tab, `Events_Reference`, is a
**read-only mirror** of the public Events sheet (Phase 3a; see Tab 3 below) used
only as a join target — it holds no partner data.

> **Privacy wall.** The `Partners` and `EventPartnerLinks` tabs are internal.
> They are never written to a published CSV and never served on a public URL.

Types are how the value is stored/intended, not a DB engine type (Sheets is
untyped). `Req` = required for a record to be valid (enforced by the Add/Edit
dialogs in a later phase; the sheet marks them and constrains their values).

---

## Tab 1 — `Partners`

One row per distribution partner org. `PartnerID` is a UUID auto-generated once
when a new row gets content (see "UUID generation" below). The address is
geocoded **once** at creation and `latitude`/`longitude` cached here — never
re-geocoded on map load.

| # | Column | Type | Req | Validation / notes |
|---:|---|---|:--:|---|
| 1 | `PartnerID` | UUID (text) | ✅ | Primary key. Auto-filled with `Utilities.getUuid()`; never reused or edited. |
| 2 | `organization_name` | text | ✅ | HSDS `organization.name`. |
| 3 | `description` | text | | What the org does. |
| 4 | `website` | URL (text) | | |
| 5 | `address` | text | ✅ | Full street address; geocoded once → lat/long. |
| 6 | `city` | text | | |
| 7 | `state` | text | | 2-letter. |
| 8 | `postal_code` | text | | Store as text (preserve leading zeros). |
| 9 | `latitude` | number | | Cached geocode result. Never recomputed on load. |
| 10 | `longitude` | number | | Cached geocode result. |
| 11 | `service_name` | text | | HSDS `service.name` (e.g. "Food pantry"). |
| 12 | `contact_name` | text | | **Internal — privacy wall.** |
| 13 | `contact_phone` | text | | **Internal — privacy wall.** |
| 14 | `contact_email` | text | | **Internal — privacy wall.** |
| 15 | `pathway` | enum | ✅ | **Dropdown:** `same-day` \| `hold-redistribute`. Drives the food-safety gate below. |
| 16 | `cold_storage` | enum | ✅ | **Dropdown:** `yes` \| `no`. Legal prerequisite for the hold pathway. |
| 17 | `monthly_capacity_meals` | number | | Roughly how many meals the org can absorb per month. |
| 18 | `recurring_slot` | text | | e.g. "2nd Saturday". The org's standing cadence. |
| 19 | `partnership_status` | enum | | **Dropdown:** `candidate` \| `active` \| `paused`. |
| 20 | `assigned_chapter` | text | | FTC chapter that owns the relationship. |
| 21 | `agreement_on_file` | bool | | `TRUE`/`FALSE` (checkbox added with the Add/Edit dialog in Phase 2b). Whether a signed agreement exists… |
| 22 | `agreement_date` | date | | …and when it was signed. |
| 23 | `last_verified` | date | | **The single most important field** (PRD §8). Surfaced on every record so users know what to trust; refreshed monthly by the named data owner. Set to "now" on add; refreshed on every Edit save. |
| 24 | `FirstAdded` | date | | **System / immutable.** When the record was first created. Stamped once by the Add Partner dialog and never changed by Edit (mirrors the Events sheet's `FirstAdded`). Distinct from `last_verified`, which moves. |
| 25 | `source` | text | | **Provenance (Phase 5).** `places` for rows seeded from Google Places by **Seed Pantries**; blank for hand-added partners. Preserved by Edit (the dialog doesn't manage it). |
| 26 | `hours` | text | | **Opening hours (Phase 5).** Free text — Places' `weekdayDescriptions` joined with `; ` for seeded rows. Preserved by Edit. |

> **Reconciliation note (Phase 2b).** PRD §5 lists `last_verified` but no
> creation timestamp. The Add/Edit workflow needs an *immutable* "when was this
> first added" date that Edit never touches (so `last_verified` can move on every
> refresh without losing the original add date) — exactly the `FirstAdded` /
> `Last Updated` split the Events sheet already uses. Column 24 `FirstAdded` is
> added for that. No columns 1–23 changed order; `Code.gs`
> `CONFIG.SHEETS.PARTNERS.headers` appends `FirstAdded` to match.

### Dropdown values (data validation, reject-on-invalid)

| Column | Allowed values |
|---|---|
| `pathway` | `same-day`, `hold-redistribute` |
| `cold_storage` | `yes`, `no` |
| `partnership_status` | `candidate`, `active`, `paused` |

> **`cold_storage` scope note.** PRD §5 lists `yes / no / capacity`. Phase 2a
> ships the dropdown as `yes | no` (the legal gate is binary: does the partner
> have cold storage or not). A free-text capacity description, if needed, will
> be a *separate* optional column (`cold_storage_detail`) rather than overloading
> this one — TBD with Nick.

### Food-safety rule (encode in the UI)

`pathway` is a legal gate, not a logistics note (PRD §6, TFER §228.64):

- **`same-day`** — served same day; covered by Time as a Public Health Control.
  Food made at ≤41°F, used within the time window.
- **`hold-redistribute`** — partner refrigerates and distributes over the week.
  **Requires** `cold_storage = yes`, food ≤41°F at donation, labeling (name,
  source, date of preparation), and ability to substantiate recipient storage.

The Add/Edit UI must make the hold pathway visibly require a chilling step.

> **Seeded candidates (Phase 5) — required-fields carve-out.** Rows seeded from
> Google Places by **Seed Pantries** are written as `partnership_status =
> candidate`, `source = places`, blank `last_verified`, and **blank `pathway` /
> `cold_storage`** — these are unknown until a human qualifies the lead. They are
> unverified leads, never auto-promoted to active. The required-fields gate
> (AGENTS rule #4) is enforced where it matters: **Edit Partner** rejects a save
> without a valid `pathway` + `cold_storage`, so a candidate can't be activated or
> relied on until it's qualified. See AGENTS.md rule #4's Phase-5 note.

---

## Tab 2 — `EventPartnerLinks`

The join between events and partners. **Many-to-many** — one event can have
several partners; one partner can serve several events. Modeled as its own tab,
never as a single partner column on an event.

| # | Column | Type | Req | Validation / notes |
|---:|---|---|:--:|---|
| 1 | `LinkID` | UUID (text) | ✅ | Primary key for the link row. Auto-filled with `Utilities.getUuid()`. |
| 2 | `EventID` | UUID (text) | ✅ | **Foreign key → Events (`EventID`).** See Events schema below. |
| 3 | `PartnerID` | UUID (text) | ✅ | **Foreign key → `Partners.PartnerID`.** |
| 4 | `active` | bool | ✅ | `TRUE`/`FALSE` (checkbox added with the link dialog in Phase 3). Whether this event↔partner link is currently live. |
| 5 | `recurring_slot` | text | | Per-link cadence (may differ from the partner's default). |
| 6 | `last_capacity_confirmed` | date | | Set by the pre-event capacity check (PRD §7.3). |
| 7 | `is_primary` | bool | | **Section 1.** `TRUE`/`FALSE` (checkbox). Exactly **one** link per `EventID` is the primary (Nick's first/default partner); the rest are backups. The **Link Partner to Event(s)** dialog marks one link primary and **demotes** any other primary on that event, so the one-primary-per-event invariant always holds. The leader reminder (Section 2) reminds the leader about this partner. |

`(EventID, PartnerID)` is unique: the **Link Partner to Event(s)** dialog
(Phase 3a) *upserts* — if a row for a `PartnerID`+`EventID` pair already exists,
it updates that row's `active` / `recurring_slot` instead of appending a
duplicate.

---

## Tab 3 — `Events_Reference` (read-only mirror, Phase 3a)

A local, **read-only mirror** of the public event-map Events sheet, populated by
the **Refresh Events** menu action (`refreshEvents()` in `apps-script/Code.gs`)
**and a daily time-trigger** (`ensureRefreshTrigger_`, Section 3) so it stays
current without anyone clicking. It exists only so partner links have something to
join against inside this workbook. Every refresh fetches the public published Events CSV
(`CONFIG.EVENTS_CSV_URL` — the same URL the public map reads), clears the data
rows, and rewrites them (deduped by `EventID`; rows with no `EventID` skipped).

> **Read-only, both directions.** We only ever *fetch* the already-public Events
> CSV; we never write back to the event-map sheet. No partner data is ever
> written here — every column is a public event field. The tab carries a
> warning-only protection and a header note so it isn't hand-edited.

| # | Column | Source (public Events CSV) | Notes |
|---:|---|---|---|
| 1 | `EventID` | `EventID` | Join key → `EventPartnerLinks.EventID`. |
| 2 | `City` | `City` | Display. |
| 3 | `State` | `State` | Display. |
| 4 | `Venue` | `Venue` | Display ("City — Venue" label). |
| 5 | `Address` | `Address` | For map pins / lines (Phase 3 map). |
| 6 | `Saturday` | `Saturday` | **Section 1.** Which Saturday of the month (`First`/`Second`/`Third`/`Fourth`/`Fifth`/`Last`). Drives the **next-occurrence date** in the leader reminder (Section 2). |
| 7 | `Time` | `Time` | **Section 1.** e.g. "8:30 AM - 10:30 AM". Shown in the reminder email. |
| 8 | `Leader` | `Leader` | **Section 1.** Chapter-leader first name. Matched to the `Leaders` tab to resolve who to remind. |
| 9 | `Status` | `Status` | e.g. "Live". |
| 10 | `Paused` | `Paused` | `Yes`/`No`. |
| 11 | `Latitude` | `Latitude` | Cached geocode (from the event map). |
| 12 | `Longitude` | `Longitude` | Cached geocode. |

Columns are a subset of the public Events CSV, named identically so the refresh
maps straight across. Add a column here only if the private map needs another
*public* event field — never a partner field. (`Saturday` / `Time` / `Leader` are
public event fields the event map already publishes — adding them keeps the
privacy wall intact.)

---

## Tab 4 & 5 — `Partners_Public` / `Links_Public` (published, Phase 3b)

Auto-generated by **Rebuild public view** (`rebuildPublicView()` in
`apps-script/Code.gs`) and **published to web as CSV** for the public Cloudflare
distribution map (`src/index.html`). This is the Phase-3b scoped override of the
privacy wall (decided 2026-06-19): only the NON-CONTACT subset below is ever
published. Both tabs are fully rebuilt on each run, navy-styled, and carry a
warning-only protection + header note.

> **Never published here:** `contact_name`, `contact_phone`, `contact_email`,
> `agreement_on_file`, `agreement_date`, `last_verified`. Do not widen these
> column sets to include any of them.

**`Partners_Public`** — one row per partner (subset of Tab 1):

| # | Column | From `Partners` |
|---:|---|---|
| 1 | `PartnerID` | `PartnerID` |
| 2 | `organization_name` | `organization_name` |
| 3 | `city` | `city` |
| 4 | `address` | `address` |
| 5 | `latitude` | `latitude` |
| 6 | `longitude` | `longitude` |
| 7 | `pathway` | `pathway` |
| 8 | `cold_storage` | `cold_storage` |
| 9 | `monthly_capacity_meals` | `monthly_capacity_meals` |
| 10 | `recurring_slot` | `recurring_slot` |
| 11 | `partnership_status` | `partnership_status` |

**`Links_Public`** — one row per event↔partner link (subset of Tab 2). Only links
whose partner is in `Partners_Public` AND whose event is in `Events_Reference` are
emitted (`last_capacity_confirmed` and the per-link `recurring_slot` stay
internal):

| # | Column | From `EventPartnerLinks` |
|---:|---|---|
| 1 | `PartnerID` | `PartnerID` |
| 2 | `EventID` | `EventID` |
| 3 | `active` | `active` (normalized `TRUE`/`FALSE`) |

The public map reads these two CSVs plus `Events_Reference` (Tab 3, also
published) to draw event pins, partner pins, and the connecting lines.

---

## Tab 6 — `CapacityChecks` (Phase 4)

The pre-event capacity-check log. One row per (event, date, partner) ask. Rows are
created by the **leader reminder** workflow (Section 2) — the daily batch
**sendLeaderReminders** and the single-event **runCapacityCheck** both upsert one
row (for the event's **primary** partner) via `upsertCapacityCheck_`; **Find Nearby
Pantries** upserts one for a chosen backup (`getBackupReminderLink`). All carry
`Status='sent'`. Rows are updated by the Google-Form submit trigger
(`onCapacityFormSubmit()`). **Internal only** — like `Partners` /
`EventPartnerLinks`, it is never published and holds no data in the public view.
Built by `Set up sheets`; `CheckID` auto-fills via the `onEdit` trigger; `Status`
is a reject-on-invalid dropdown.

> **No direct partner emails (Section 2).** The system reminds the event's *leader*
> (resolved from the `Leaders` tab) and hands them a prefilled link to forward; it
> never emails partners directly. A re-send preserves an existing response —
> `upsertCapacityCheck_` only refreshes `SentTimestamp`, never wiping a partner's
> answer.

| # | Column | Type | Req | Validation / notes |
|---:|---|---|:--:|---|
| 1 | `CheckID` | UUID (text) | ✅ | Primary key for the check row. The **reference code** prefilled into the partner's form link so responses route back to this exact row. |
| 2 | `EventID` | UUID (text) | ✅ | **Foreign key → Events (`EventID`).** |
| 3 | `PartnerID` | UUID (text) | ✅ | **Foreign key → `Partners.PartnerID`.** |
| 4 | `EventDate` | date (`YYYY-MM-DD`) | | The upcoming distribution date this ask is for. Part of the upsert key (`EventID`+`PartnerID`+`EventDate`). |
| 5 | `RequestedMeals` | number | | **Legacy (Phase 5).** Retained for schema/back-compat but no longer auto-filled — there is no expected total to split. New checks write it blank. |
| 6 | `ConfirmedMeals` | number | | Set on response: the partner's own number (or `0` if they said yes without one, or declined). |
| 7 | `Status` | enum | | **Dropdown:** `sent` \| `confirmed` \| `declined` \| `no-response`. `sent` on creation; the form trigger flips it to `confirmed`/`declined`. |
| 8 | `SentTimestamp` | datetime | | When the ask email went out (reset on each re-run). |
| 9 | `ResponseTimestamp` | datetime | | When the partner submitted the form (reset to blank on a re-run). |

> **Responses come from a Google Form, not email replies.** One reusable form
> (id/items cached in `DocumentProperties`) has a prefilled `CheckID`, a Yes/No
> choice, and a meals count. An installable `onFormSubmit` trigger writes back to
> columns 6–9 by `CheckID`, and stamps the matching `EventPartnerLinks` row's
> `last_capacity_confirmed`.

> **No shortfall judgment (Phase 5).** View Capacity Status reports each partner's
> response and the confirmed-meals total; it does **not** set an expected total or
> compute a shortfall — the leader reads the numbers and decides. Lining up more
> partners is a separate, always-available action, **Find Nearby Pantries**, which
> ranks the nearest partners from the full **candidate + active** universe NOT yet
> linked to the event (by lat/long; by capacity if the event has no coordinates),
> with each one's pathway, capacity, and contact. It is never gated on a computed
> shortfall.

---

## Tab 7 — `Leaders` (Section 1)

Chapter leaders. One row per leader. The leader reminder workflow (Section 2)
matches an event's `Leader` first-name (from `Events_Reference`) to a row here to
decide **who** to remind and at **what email**. Built by `Set up sheets`. **No id
column / no auto-UUID** — `leader_email` is the natural key, and `onEdit` leaves
this tab alone. Internal-only; never published.

| # | Column | Type | Req | Validation / notes |
|---:|---|---|:--:|---|
| 1 | `leader_name` | text | ✅ | Full name. The reminder resolver matches on the **first name** (so `Leaders.leader_name = "Blaine Carter"` matches an event whose `Leader = "Blaine"`). |
| 2 | `leader_email` | text | ✅ | Where the weekly reminder is sent. A matched leader with no email is **flagged**, not emailed. |
| 3 | `chapter` | text | | Which FTC chapter they lead (display). |
| 4 | `active` | bool | | `TRUE`/`FALSE` (checkbox). An active match is preferred when two leaders share a first name. |
| 5 | `notes` | text | | Free text. |

> **Resolver flags (Section 1).** `resolveEventLeader_` returns a `flag` string the
> reminder workflow surfaces (it never silently drops an event) when: the event has
> no `Leader`, no `Leaders` row matches, the matched row has no email, the match is
> inactive, or two leaders share the first name. An event whose leader can't be
> emailed (or that has no primary partner) is reported in the run summary and **not**
> deduped, so it retries on the next run once fixed.

---

## Reference — `Events` (event-map workbook, READ-ONLY)

Joined by `EventID`. **This tool does not own or write these rows** — they live
in the public event map's workbook. Sample: `reference/events-sample.csv`.
Columns as exported:

| Column | Notes |
|---|---|
| `City`, `State`, `Venue`, `Address` | Location of where food is *made*. |
| `Saturday` | Which Saturday of the month (e.g. "First"). |
| `Time` | e.g. "8:30 AM - 10:30 AM". |
| `Leader` | Chapter leader name. |
| `EventPageURL`, `GoogleMapsURL` | Public links. |
| `Paused` | `Yes` / `No`. |
| `Latitude`, `Longitude` | Cached geocode. |
| `Status`, `Last Updated`, `Notes` | |
| **`EventID`** | **UUID — the foreign key this tool joins to.** |
| `FirstAdded`, `PhotoURL` | |

Only `EventID` (plus public display fields like City/Venue/Address/lat-long) is
needed to render event pins and draw event↔partner lines on the private map.

---

## UUID generation

A simple `onEdit` trigger in `apps-script/Code.gs` watches the `Partners` and
`EventPartnerLinks` tabs. When a row below the header gains content and its ID
cell (`PartnerID` / `LinkID`) is still blank, the trigger stamps a fresh
`Utilities.getUuid()`. Rows with no user content are left alone, so a stray
edit in an empty row never mints a ghost ID.
