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

## Two surfaces

The tool is **two surfaces over one set of partner data**:

1. **The private sheet — the back office.** A separate `FTC Distribution
   (Partners)` Google Sheets workbook with a bound Apps Script app. This is where
   the work happens: partners are added/qualified, linked to events, reminded, and
   maintained. Contact info, agreements, and `last_verified` live here and never
   leave.
2. **The public map — the display.** A self-contained `src/index.html` on its own
   Cloudflare Pages project that reads only the published **non-contact** CSVs. It
   shows where food goes: event pins, active partner pins (colored by pathway),
   candidate pantries (gray, toggleable), and the event→partner lines.

## How it works — the monthly cycle

```
Nick assigns a primary partner  →  events auto-import (daily)  →  weekly leader
reminder  →  leader forwards the partner a prefilled form  →  partner replies  →
leader reads the number and decides  →  leader lines up backups (Find Nearby Pantries)
```

- **Assign.** In **Link Partner to Event(s)**, Nick marks one partner per event as
  **primary** (his first/default partner); the rest are backups.
- **Auto-import.** A daily trigger runs **Refresh Events**, mirroring the public
  Events sheet into `Events_Reference` (with each event's Saturday-of-month and
  leader).
- **Remind.** A daily trigger runs **sendLeaderReminders** (also a **Send Reminders
  Now** menu item). For every event ~7 days out it emails the **event's leader** a
  reminder with the primary partner's contact and a ready-to-forward message
  containing the partner's **prefilled confirmation link**. The system never emails
  partners directly. A dedupe stops a leader being reminded twice for the same date.
- **Confirm.** The partner submits one reusable Google Form; the response logs back
  to `CapacityChecks` (yes/no + their own meal number).
- **Decide.** The leader reads the confirmed number in **View Capacity Status**.
  **The app never predicts or judges meal counts** — it asks the partner their
  number, logs it, and shows it. No expected total, no shortfall.
- **Backups.** Any time, **Find Nearby Pantries** ranks the nearest candidate +
  active partners to an event (excluding ones already linked), each with a one-click
  **prefilled backup form link** so the leader reaches out the same way.

The candidate universe is populated by **Seed Pantries (Places)** — bulk-loading
food pantries/banks/soup kitchens near each event from the Google Places API as
unverified `candidate` rows (never auto-promoted; `pathway` + `cold_storage` are
required before a candidate can be activated in **Edit Partner**).

See the schema in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) and the deploy guide in
[`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).

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
│   ├── Code.gs            # Admin logic: setup, Add/Edit Partner, links, leaders, reminders, triggers, public view
│   ├── AddPartnerDialog.html / EditPartnerDialog.html             # Phase 2b — add/edit + geocode
│   ├── LinkPartnerDialog.html / ViewLinksDialog.html              # Phase 3a — event↔partner links (+ primary)
│   ├── RunCapacityCheckDialog.html / ViewCapacityStatusDialog.html# Leader reminder (one event) + status
│   ├── FindPantriesDialog.html                                    # Nearby-pantry recommender (+ backup link)
│   └── .clasp.json.example# Copy to .clasp.json and add your scriptId
├── docs/
│   ├── DATA_MODEL.md      # Column-by-column schema: Partners, Links, Leaders, Events, public tabs, CapacityChecks
│   ├── PUBLIC_MAP.md      # Phase 3b deploy guide (published CSVs + Cloudflare Pages)
│   └── SMOKE_TEST.md      # Human smoke-test checklist (run after clasp push)
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
`EventPartnerLinks`, `Leaders`, and `CapacityChecks` tabs **and install the daily
auto-triggers** (Refresh Events + leader reminders). The full `FTC` menu also
covers Add/Edit Partner, Refresh Events, Link Partner to Event(s) (mark a primary),
View Links, **Send Reminders Now**, **Send Reminder for One Event**, View Capacity
Status, Find Nearby Pantries, Seed Pantries (Places), and Rebuild public view.
Fill the **Leaders** tab (`leader_name`, `leader_email`, `chapter`, `active`) so
reminders know who to email. To deploy the public map, follow
[`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).

> **Triggers need authorization.** Installing the daily time-triggers happens when
> you run **Set up sheets** from the menu (it requires the ScriptApp scope, which
> you grant on first run). Re-run Set up sheets any time to repair them.

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
