# Data Model

Column-by-column schema for the FTC Distribution Tool. Adopts the HSDS
("Open Referral") shape so the data is standard and portable. Expands `PRD.md`
§5; see `AGENTS.md` for the hard rules.

**This file is the contract.** The header rows written by the Apps Script
`Set up sheets` function (`apps-script/Code.gs`, `CONFIG.PARTNER_HEADERS` /
`CONFIG.LINK_HEADERS`) MUST match the column names below, in this exact order.
Change one, change the other.

Two tabs live in the **Partners workbook** — a *separate* Google Sheets workbook
(`FTC Distribution (Partners)`) from the public event-map Events sheet. That
separation is the privacy wall.

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

`(EventID, PartnerID)` should be unique among active links.

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
