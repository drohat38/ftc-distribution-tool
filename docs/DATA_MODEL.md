# Data Model

Column-by-column schema for the FTC Distribution Tool. Adopts the HSDS
("Open Referral") shape so the data is standard and portable. See `PRD.md` §5
for the rationale and `AGENTS.md` for the hard rules.

Two tabs live in the **Partners + Links workbook** (a *separate* Google Sheets
workbook from the public event-map Events sheet — the privacy wall). The Events
data below lives in the **event map's** workbook and is referenced read-only by
`EventID`.

> **Privacy wall.** The Partners and EventPartnerLinks tabs are internal. They
> are never written to a published CSV and never served on a public URL.

---

## Tab 1 — `Partners`

One row per distribution partner org. `PartnerID` is a UUID, generated once on
creation. Address is geocoded **once** at creation and `latitude`/`longitude`
are cached here — never re-geocode on map load.

### HSDS core

| Column | Type | Req | Notes |
|---|---|:--:|---|
| `PartnerID` | UUID | ✅ | Primary key. Generated once; never reused. |
| `organization_name` | text | ✅ | HSDS `organization.name`. |
| `description` | text | | What the org does. |
| `website` | url | | |
| `address` | text | ✅ | Full street address; geocoded once. |
| `city` | text | | |
| `state` | text | | 2-letter. |
| `postal_code` | text | | |
| `latitude` | number | | Cached geocode result. Never recomputed on load. |
| `longitude` | number | | Cached geocode result. |
| `service_name` | text | | HSDS `service.name` (e.g. "Food pantry"). |
| `contact_name` | text | | **Internal — privacy wall.** |
| `contact_phone` | text | | **Internal — privacy wall.** |
| `contact_email` | text | | **Internal — privacy wall.** |

### FTC fields

| Column | Type | Req | Notes |
|---|---|:--:|---|
| `pathway` | enum | ✅ | `same-day` \| `hold-redistribute`. Drives food-safety rules (see below). |
| `cold_storage` | enum/text | ✅ | `yes` \| `no` \| capacity note. **Legal prerequisite** for the hold pathway. |
| `monthly_capacity_meals` | number | | Roughly how many meals the org can absorb per month. |
| `recurring_slot` | text | | e.g. "2nd Saturday". The org's standing cadence. |
| `partnership_status` | enum | | `candidate` \| `active` \| `paused`. |
| `assigned_chapter` | text | | FTC chapter that owns the relationship. |
| `agreement_on_file` | bool | | Whether a signed agreement exists… |
| `agreement_date` | date | | …and when it was signed. |
| `last_verified` | date | | **The single most important field** (PRD §8). Surfaced on every record so users know what to trust. Refreshed monthly by the named data owner. |

### Food-safety rule (encode in the UI)

`pathway` is not a logistics note — it is a legal gate (PRD §6, TFER §228.64):

- **`same-day`** — served same day; covered by Time as a Public Health Control.
  Food made at ≤41°F, used within the time window.
- **`hold-redistribute`** — partner refrigerates and distributes over the week.
  **Requires** `cold_storage` = yes, food ≤41°F at donation, labeling (name,
  source, date of preparation), and ability to substantiate recipient storage.

The UI must make the hold pathway visibly require a chilling step.

---

## Tab 2 — `EventPartnerLinks`

The join between events and partners. **Many-to-many** — one event can have
several partners; one partner can serve several events. Modeled as its own tab,
never as a single partner column on an event.

| Column | Type | Req | Notes |
|---|---|:--:|---|
| `LinkID` | UUID | ✅ | Primary key for the link row. |
| `EventID` | UUID | ✅ | FK → Events (`EventID`). See Events schema below. |
| `PartnerID` | UUID | ✅ | FK → `Partners.PartnerID`. |
| `active` | bool | ✅ | Whether this event↔partner link is currently live. |
| `recurring_slot` | text | | Per-link cadence (may differ from the partner's default). |
| `last_capacity_confirmed` | date | | Set by the pre-event capacity check (PRD §7.3). |

`(EventID, PartnerID)` should be unique for active links.

---

## Reference — `Events` (event-map workbook, read-only)

Joined by `EventID`. **This tool does not own or write these rows** — they live
in the public event map's workbook. Sample: `reference/events-sample.csv`.
Columns as exported:

| Column | Notes |
|---|---|
| `City` | |
| `State` | |
| `Venue` | |
| `Address` | |
| `Saturday` | Which Saturday of the month (e.g. "First"). |
| `Time` | e.g. "8:30 AM - 10:30 AM". |
| `Leader` | Chapter leader name. |
| `EventPageURL` | Public tangocharities.org event page. |
| `GoogleMapsURL` | |
| `Paused` | `Yes` / `No`. |
| `Latitude` | Cached geocode. |
| `Longitude` | Cached geocode. |
| `Status` | e.g. `Live`. |
| `Last Updated` | |
| `Notes` | |
| **`EventID`** | **UUID — the foreign key this tool joins to.** |
| `FirstAdded` | |
| `PhotoURL` | |

Only `EventID` (plus public display fields like City/Venue/Address/lat-long) is
needed to render event pins and draw event↔partner lines on the private map.
