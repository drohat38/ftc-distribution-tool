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

🚧 **Phase 4 — pre-event capacity check.** A separate, private `FTC Distribution
(Partners)` Google Sheets workbook exists with a bound Apps Script project. The
`FTC` menu sets up the `Partners`, `EventPartnerLinks`, and `CapacityChecks` tabs
(headers, dropdowns, auto-UUID) and covers: Add/Edit Partner with one-time
geocoding (Phase 2b); Refresh Events + Link Partner to Event(s) + View Links
(Phase 3a); the public distribution map via Rebuild public view (Phase 3b); and
now **Run Capacity Check** / **View Capacity Status** — emailing active partners
to confirm volume the week before an event, logging Google-Form responses back to
`CapacityChecks`, and suggesting nearest backups on a shortfall. See the build
phases in [`PRD.md`](PRD.md) §10 and the schema in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Stack

- **Database:** Google Sheets, in a **separate workbook** from the public Events sheet.
- **Admin app:** Google Apps Script via [`clasp`](https://github.com/google/clasp),
  running inside the sheet (`apps-script/`).
- **Private map:** an Apps Script web app, gated by Google sign-in (reads
  Partners + Links server-side; never published publicly).

Do **not** introduce Supabase, Airtable, or Salesforce. This is the Tier A build.

## Repository layout

```
.
├── AGENTS.md              # Canonical agent context (read every session)
├── CLAUDE.md              # Just @AGENTS.md
├── PRD.md                 # Product requirements — the what & why
├── CHANGELOG.md           # Keep current with every meaningful change
├── apps-script/           # clasp project — Apps Script admin app + web app
│   ├── appsscript.json    # Apps Script manifest
│   ├── Code.gs            # Entry-point stub (no features yet)
│   └── .clasp.json.example# Copy to .clasp.json and add your scriptId
├── docs/
│   └── DATA_MODEL.md      # Column-by-column schema: Partners, Links, Events
├── reference/
│   └── events-sample.csv  # Read-only sample of the event-map Events schema
├── src/                   # Reserved (empty)
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

Then, in the sheet: **FTC → Set up sheets** to build the `Partners` and
`EventPartnerLinks` tabs.

`.clasp.json` and `.clasprc.json` are gitignored — they hold your project
binding and credentials. `apps-script/.clasp.json.example` shows the shape.

## Brand

- Orange `#FF6500`
- Navy `#003366`

## Contributing workflow

Small, reviewable steps. Smoke-test after each change, then stage all, commit
with a conventional message (`feat:`, `fix:`, `docs:`…), and let the post-commit
hook push. Keep [`CHANGELOG.md`](CHANGELOG.md) current.
