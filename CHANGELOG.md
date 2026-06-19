# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project will adopt [Semantic Versioning](https://semver.org/) once it ships.

## [Unreleased]

### Added — Phase 3a: Link partners to events (the join)
- **Refresh Events** (`refreshEvents()` in `apps-script/Code.gs`) — fetches the
  public event-map's published Events CSV (`CONFIG.EVENTS_CSV_URL`, the same URL
  the public map reads — found in
  `reference/feed-the-city-event-map/src/index.html`) and mirrors `EventID` +
  public display fields (`City`, `State`, `Venue`, `Address`, `Status`,
  `Paused`, `Latitude`, `Longitude`) into a new **read-only** `Events_Reference`
  tab. Read-only both directions: only the already-public CSV is fetched, never
  written back, and no partner data is written here (privacy wall — AGENTS.md
  #1/#2). Each run clears + rewrites the data rows, deduped by `EventID`
  (blank-`EventID` rows skipped + reported); the tab gets a warning-only
  protection and a header note so it isn't hand-edited.
- **Link Partner to Event(s)** (`apps-script/LinkPartnerDialog.html` +
  `openLinkPartnerDialog()` / `getLinkDialogData()` / `linkPartnerToEvents()`) —
  pick one partner (dropdown by name), multi-select one or more events (filtered
  checkbox list showing "City — Venue" + live/paused badge, value = `EventID`),
  set per-link `recurring_slot` and `active`. On submit, **upserts** one row per
  pair into `EventPartnerLinks`: an existing `PartnerID`+`EventID` row is
  **updated** (keeping its `LinkID`) rather than duplicated. Many-to-many — a
  partner can link to many events and an event to many partners. Unknown/stale
  event ids are skipped and reported.
- **View Links** (`apps-script/ViewLinksDialog.html` +
  `openViewLinksDialog()` / `getLinksForPartner()` / `getLinksForEvent()`) —
  toggle "By partner" (a partner's linked events) or "By event" (an event's
  linked partners); shows `active`, `recurring_slot`, and
  `last_capacity_confirmed`, and flags links whose event/partner is no longer
  present.
- `apps-script/Code.gs`: `CONFIG.EVENTS_CSV_URL` + `CONFIG.EVENTS_REF`; the
  `EventPartnerLinks` `active` column is now a real checkbox
  (`CONFIG.SHEETS.LINKS.checkboxes = ['active']`); added link/event read helpers
  (`readAllPartners_`, `readEventsReference_`, `readAllLinks_`, `readAllRows_`,
  `writeLinkRow_`, `ensureLinkHeaders_`, `eventLabel_`, `partnerLocation_`,
  `isTruthyFlag_`, `fetchEventsCsv_`, `setupEventsReferenceSheet_`). FTC menu
  adds **Refresh Events**, **Link Partner to Event(s)**, **View Links**.
- `docs/DATA_MODEL.md`: documented the `Events_Reference` read-only mirror
  (Tab 3) and the `(EventID, PartnerID)` upsert/uniqueness rule.
- The Maps geocoder scope (`script.external_request`) added in Phase 2b also
  covers the `UrlFetchApp` call to the Events CSV — no manifest change needed.

### Added — Phase 2b: Add / Edit Partner with geocoding
- `apps-script/AddPartnerDialog.html` — Add Partner dialog (modeled on the event
  map's `AddEventDialog`, restyled to FTC brand: orange `#FF6500`, navy
  `#003366`). Fields cover the full Partners schema; contact fields are flagged
  **INTERNAL** (privacy wall). On submit, the server `addPartner()` generates the
  UUID `PartnerID`, geocodes the address once to lat/long (skipped if valid
  coordinates already exist), defaults `partnership_status` to `candidate`, and
  stamps `FirstAdded` + `last_verified`.
- `apps-script/EditPartnerDialog.html` — Edit Partner dialog (modeled on
  `EditEventDialog`). Loads a row by number, shows a diff on save, surfaces
  `PartnerID` / `last_verified` / `FirstAdded` in a meta bar (PRD §8). Server
  `updatePartner()` preserves `PartnerID` + `FirstAdded`, refreshes
  `last_verified` on every save, and **re-geocodes only when the address
  changed**.
- **Food-safety gate (PRD §6, AGENTS.md rule #4, TFER §228.64).** Both dialogs
  make the `hold-redistribute` pathway visibly require cold storage: selecting it
  shows a chilling-step callout and blocks save unless `cold_storage = yes`.
  Enforced again server-side in `validatePartnerDraft_()` so an invalid record
  can never reach the sheet from any caller.
- Geocoding reuses the event map's pattern verbatim —
  `Maps.newGeocoder().setRegion('us').geocode(query)`, Apps Script's **keyless**
  built-in geocoder (NOT the public map's Maps JS key). Result cached in
  `latitude`/`longitude`; never recomputed on map load.
- `apps-script/Code.gs`: replaced the `Add Partner` stub with
  `openAddPartnerDialog()` / `openEditPartnerDialog()`; added server
  `addPartner()`, `updatePartner()`, `getPartnerForEdit()` and partner helpers
  (`normalizePartnerDraft_`, `validatePartnerDraft_`, `fillPartnerCoordinates_`,
  `validLatLng_`, `readPartnerRow_`, `writePartnerRow_`,
  `applyPartnerRowValidation_`, `ensurePartnerHeaders_`, `getActivePartnerRow_`,
  `partnerAddressSig_`, `partnerGeocodeQuery_`). FTC menu now leads with **Add
  Partner** and **Edit Partner**; `setupSheets()` also lays down the
  `agreement_on_file` checkbox column.
- `apps-script/appsscript.json`: added the
  `https://www.googleapis.com/auth/script.external_request` scope required by the
  Maps geocoder (matches the proven event-map manifest).

### Changed — schema reconciliation (docs/DATA_MODEL.md)
- Reconciled `docs/DATA_MODEL.md` against PRD §5 and
  `reference/events-sample.csv`: Partners columns 1–23 and the `EventID` join key
  already matched. **Drift fixed:** the Add/Edit workflow needs an immutable
  creation timestamp that Edit never touches, so added **column 24 `FirstAdded`**
  (date, system/immutable) — distinct from `last_verified`, which moves on every
  refresh. Mirrors the Events sheet's `FirstAdded` / `Last Updated` split. No
  columns 1–23 changed order; `CONFIG.SHEETS.PARTNERS.headers` updated to match.

### Added — Phase 2a: data foundation
- Created the **separate, private** `FTC Distribution (Partners)` Google Sheets
  workbook with a bound Apps Script project via `clasp create --type sheets`
  (distinct from the public event-map workbook — privacy wall).
- `apps-script/Code.gs`: `FTC` menu (`Set up sheets`, `Add Partner` stub),
  `setupSheets()` that builds the `Partners` and `EventPartnerLinks` tabs with
  the exact `docs/DATA_MODEL.md` headers, brand-orange styled header row, and
  dropdown validation (`pathway`, `cold_storage`, `partnership_status`); a
  simple `onEdit` trigger that auto-fills `PartnerID` / `LinkID` UUIDs.
- `apps-script/appsscript.json`: `America/Chicago`, scopes
  `spreadsheets.currentonly` + `script.container.ui`.
- Expanded `docs/DATA_MODEL.md` to exact columns + types for both tabs.
- Cloned the event-map repo to `reference/feed-the-city-event-map/` as
  read-only reference (gitignored, never modified).

### Added — Phase 1: scaffold
- Initial repository scaffold (Phase 1 of `PRD.md` §10):
  - `AGENTS.md` canonical agent context and `CLAUDE.md` (`@AGENTS.md`).
  - `apps-script/` clasp project stub — `appsscript.json` manifest, `Code.gs`
    entry-point stub, `.clasp.json.example`.
  - `docs/DATA_MODEL.md` — column-by-column schema for Partners,
    EventPartnerLinks, and the Events join.
  - `reference/events-sample.csv` — read-only sample of the event-map Events
    schema (join key: `EventID`).
  - Empty `src/` placeholder.
  - `.githooks/post-commit` auto-push hook + `core.hooksPath` setup.
  - `README.md`, `CHANGELOG.md`, `.gitignore`.
  - Private GitHub repo `drohat38/ftc-distribution-tool` wired as `origin`.

_No application features yet — scaffold only._
