# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project will adopt [Semantic Versioning](https://semver.org/) once it ships.

## [Unreleased]

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
