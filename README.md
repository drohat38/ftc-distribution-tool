# FTC Distribution Tool

Internal **partner-distribution tool** for Feed the City (Tango Charities).

It is the sibling of the public [event map](https://github.com/drohat38/feed-the-city-event-map):

- The **event map** shows where food is *made* — public, volunteer-facing.
- **This tool** maps where food *goes* — the partner orgs that receive it. **Internal only.**

The two link by `EventID` (stable UUIDs already used by the event map — see
[`reference/events-sample.csv`](reference/events-sample.csv)).

> ⚠️ **Privacy wall.** Partner data (contacts, capacity, who-receives-what) is
> internal. It is **never** written to a published CSV and **never** served on a
> public URL. See [`AGENTS.md`](AGENTS.md) and [`PRD.md`](PRD.md).

## Status

🚧 **Phase 5 — pantry universe + leader-triggered backups.** A separate, private
`FTC Distribution (Partners)` Google Sheets workbook exists with a bound Apps
Script project. The `FTC` menu sets up the `Partners`, `EventPartnerLinks`, and
`CapacityChecks` tabs (headers, dropdowns, auto-UUID) and covers: Add/Edit Partner
with one-time geocoding (Phase 2b); Refresh Events + Link Partner to Event(s) +
View Links (Phase 3a); the public distribution map via Rebuild public view
(Phase 3b); and **Run Capacity Check** / **View Capacity Status** — emailing active
partners the week before an event and logging Google-Form responses back to
`CapacityChecks`.

Phase 5 reframes the recommendation as a leader-initiated action and populates the
universe: the capacity check no longer sets an expected total or judges a shortfall
(the leader reads the confirmed numbers and decides); **Seed Pantries (Places)**
bulk-loads food pantries/banks/soup kitchens near each event from the Google Places
API as unverified `candidate` rows; and **Find Nearby Pantries** ranks the nearest
candidates + actives to a chosen event (excluding ones already linked), any time.
See the build phases in [`PRD.md`](PRD.md) §10 and the schema in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Stack

- **Database:** Google Sheets, in a **separate workbook** from the public Events sheet.
- **Admin app:** Google Apps Script via [`clasp`](https://github.com/google/clasp),
  running inside the sheet (`apps-script/`).
- **Public distribution map (Phase 3b, what shipped):** a self-contained
  `src/index.html` on its own Cloudflare Pages project, reading the published
  non-contact CSVs (`Partners_Public` / `Links_Public` / `Events_Reference`).
  See [`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).
- **Private gated map (PRD §4, not yet built):** the planned Apps Script web app
  gated by Google sign-in (full internal view, contacts included). Remains the
  model for the full internal view; no `doGet` web app exists yet.

Do **not** introduce Supabase, Airtable, or Salesforce. This is the Tier A build.

## Repository layout

```
.
├── AGENTS.md              # Canonical agent context (read every session)
├── CLAUDE.md              # Just @AGENTS.md
├── PRD.md                 # Product requirements — the what & why
├── CHANGELOG.md           # Keep current with every meaningful change
├── apps-script/           # clasp project — Apps Script admin app (bound to the Partners workbook)
│   ├── appsscript.json    # Manifest: sheets, geocoder/UrlFetch, UI, mail, scriptapp, forms scopes
│   ├── Code.gs            # Admin logic: setup, Add/Edit Partner, links, public view, capacity check
│   ├── AddPartnerDialog.html / EditPartnerDialog.html             # Phase 2b — add/edit + geocode
│   ├── LinkPartnerDialog.html / ViewLinksDialog.html              # Phase 3a — event↔partner links
│   ├── RunCapacityCheckDialog.html / ViewCapacityStatusDialog.html# Phase 4 — capacity check
│   ├── FindPantriesDialog.html                                    # Phase 5 — nearby-pantry recommender
│   └── .clasp.json.example# Copy to .clasp.json and add your scriptId
├── docs/
│   ├── DATA_MODEL.md      # Column-by-column schema: Partners, Links, Events, public tabs, CapacityChecks
│   └── PUBLIC_MAP.md      # Phase 3b deploy guide (published CSVs + Cloudflare Pages)
├── reference/
│   └── events-sample.csv  # Read-only sample of the event-map Events schema
├── src/
│   └── index.html         # Phase 3b public distribution map (reads the 3 published CSVs)
└── .githooks/
    └── post-commit        # Auto-pushes to origin/main after each commit
```

## Setup

### 1. Git hooks (auto-push)

This repo uses a tracked `post-commit` hook that auto-pushes to `origin/main`.
Point git at it once per clone:

```sh
git config core.hooksPath .githooks
```

After that, every `git commit` pushes automatically (per the
[`AGENTS.md`](AGENTS.md) git workflow).

### 2. clasp (Apps Script)

The bound project already exists (created in Phase 2a). `apps-script/.clasp.json`
(which holds its `scriptId`) is gitignored, so a fresh clone needs to re-bind:

```sh
npm install -g @google/clasp     # if not already installed
clasp login
cd apps-script
clasp clone <scriptId>           # get the scriptId from the project owner
clasp push                       # deploy Code.gs + appsscript.json
```

Then, in the sheet: **FTC → Set up sheets** to build the `Partners`,
`EventPartnerLinks`, and `CapacityChecks` tabs. The full `FTC` menu also covers
Add/Edit Partner, Refresh Events, Link Partner to Event(s), View Links, Run
Capacity Check, View Capacity Status, Find Nearby Pantries, Seed Pantries
(Places), and Rebuild public view. To deploy the public map, follow
[`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).

### 3. Places API key (for Seed Pantries)

**Seed Pantries (Places)** needs a **server-side** Google Places API (New) key —
separate from the public map's referrer-restricted browser key. In the Apps Script
editor: **Project Settings ▸ Script Properties ▸** add `PLACES_API_KEY` with the
key. Restrict that key to the Places API (NOT by HTTP referrer). Optional overrides:
`PLACES_RADIUS_MILES` (default 15) and `PLACES_MAX_PER_EVENT` (default 20).

`.clasp.json` and `.clasprc.json` are gitignored — they hold your project
binding and credentials. `apps-script/.clasp.json.example` shows the shape.

## Brand

- Orange `#FF6500`
- Navy `#003366`

## Contributing workflow

Small, reviewable steps. Smoke-test after each change, then stage all, commit
with a conventional message (`feat:`, `fix:`, `docs:`…), and let the post-commit
hook push. Keep [`CHANGELOG.md`](CHANGELOG.md) current.
