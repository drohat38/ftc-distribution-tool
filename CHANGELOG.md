# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project will adopt [Semantic Versioning](https://semver.org/) once it ships.

## [Unreleased]

### Added
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
