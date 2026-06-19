# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project will adopt [Semantic Versioning](https://semver.org/) once it ships.

## [Unreleased]

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
