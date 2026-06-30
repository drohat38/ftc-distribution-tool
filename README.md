# FTC Distribution Tool

A back-office tool that maps Feed the City's **distribution network** — the partner
organizations that receive the food its events produce — so surplus food always has
somewhere to go.

It is the sibling of the public
[event map](https://github.com/drohat38/feed-the-city-event-map): the event map shows
where food is *made* (public, volunteer-facing); this tool tracks where food *goes*.
The two join on a shared `EventID`.

> **Status: working prototype, in internal use.** The Google Sheets + Apps Script
> back office and the public distribution map are built and deployable. The
> sign-in-gated internal web app described in [`PRD.md`](PRD.md) §4 is **not built
> yet**. See [Built vs planned](#built-vs-planned) for the honest breakdown.

> **This repository is public; the operational data is not.** The code, schema, and
> docs are safe to be public. The real partner records — contacts, agreements,
> capacity, and who-receives-what — live in a private Google Sheets workbook and are
> **never committed here**. See [Privacy and data boundaries](#privacy-and-data-boundaries),
> which is the most important section to read before reusing or extending this repo.

## Overview

Feed the City runs recurring volunteer cook events; each event hands its food to a
local partner org (a pantry, shelter, or soup kitchen). Historically that hand-off
was arranged by one person making phone calls, with no shared record of which
partners exist, what they can take, whether they can refrigerate, and which event is
connected to whom — so when an event over-produced, surplus food risked being wasted.

This tool is **two surfaces over one private dataset**:

1. **The back office (private).** A separate `FTC Distribution (Partners)` Google
   Sheets workbook with a bound Google Apps Script app. Partners are added, qualified
   for food-safety compliance, linked to events, and reminded here. Contact details,
   agreements, and verification dates live in this workbook and never leave it.
2. **The distribution map (public).** A self-contained `src/index.html` on its own
   Cloudflare Pages site that reads only a published **non-contact** subset of the
   data. It shows event pins, partner pins (colored by food-safety pathway), candidate
   pantries, and the lines connecting each event to the partners it feeds.

## Built vs planned

| Component | State | Notes |
|---|---|---|
| Google Sheets schema (`Partners`, `EventPartnerLinks`, `Leaders`, `CapacityChecks`, `Events_Reference`) | **Built** | Created by **FTC ▸ Set up sheets**. Schema is the contract in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). |
| Apps Script admin app (`apps-script/`) | **Built** | Add/Edit Partner with geocoding, event↔partner links, leader reminders, Google-Form capacity checks, Places seeding, public-view rebuild. |
| Daily automation (triggers) | **Built** | Two time-triggers: refresh `Events_Reference`, send weekly leader reminders. |
| Public distribution map (`src/index.html`) | **Built** | Deploys to Cloudflare Pages; reads three published CSVs. |
| Sign-in-gated internal web app (full view, contacts included) | **Planned** | PRD §4. No `doGet` web app exists yet; the back office today is the sheet itself. |
| Automated tests / CI | **None** | The app runs inside Google's environment; it is verified by the manual [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) checklist after `clasp push`. |

The build history is in [`CHANGELOG.md`](CHANGELOG.md); product rationale is in
[`PRD.md`](PRD.md).

## Features

The back office covers the full monthly cycle:

- **Add / qualify partners.** The qualifying questions *are* the data fields and
  double as food-safety documentation (cold storage? same-day or hold-and-redistribute?
  how many meals? which Saturday?). Addresses are geocoded once and cached.
- **Link partners to events** (many-to-many). One event can feed several partners and
  one partner can serve several events; exactly one partner per event is marked
  **primary** and the rest are backups.
- **Weekly leader reminders.** A daily trigger emails each event's **leader** (never
  the partner directly) a ready-to-forward message containing the partner's prefilled
  confirmation form. The partner's reply logs back to the capacity-check log.
- **Capacity checks without judgment.** The app records each partner's confirmed meal
  number and shows it; it never predicts a total or computes a shortfall — the leader
  reads the number and decides.
- **Find nearby pantries (backups on demand).** Ranks the nearest candidate + active
  partners to an event, each with a one-click prefilled backup form link.
- **Seed the candidate universe** from the Google Places API as unverified `candidate`
  rows (never auto-promoted; a valid `pathway` + `cold_storage` is required before a
  candidate can be activated).
- **Rebuild public view.** Regenerates the non-contact `Partners_Public` /
  `Links_Public` tabs that feed the public map.

The public map renders navy event pins, partner pins colored by pathway (orange =
same-day, teal = hold-and-redistribute), gray candidate pantries with a show/hide
toggle, and event→partner lines, with click-through detail and a 10-minute
auto-refresh.

## Privacy and data boundaries

This repo was originally built to be private, and a few comments/docs still reflect
that. It is now **public**, so the boundary matters. The rule:

**Published (safe to be public) — the non-contact partner subset.** Generated by
**Rebuild public view** into the `Partners_Public` / `Links_Public` tabs and served by
the map:

- `organization_name`, `city`, `address`, `latitude`, `longitude`
- `pathway`, `cold_storage`, `monthly_capacity_meals`, `recurring_slot`,
  `partnership_status`
- the event↔partner links (`PartnerID`, `EventID`, `active`)

> The map therefore *does* show partner **organization names and street addresses** in
> public — this is a deliberate decision (2026-06-19), not an accident. If a partner has
> not agreed to be listed on a public map, do not publish its row (don't include it when
> you run **Rebuild public view**).

**Never published — internal only.** Excluded by construction in
`rebuildPublicView()` (`apps-script/Code.gs`) and never read by the map:

- `contact_name`, `contact_phone`, `contact_email`
- `agreement_on_file`, `agreement_date`, `last_verified`
- per-link `recurring_slot`, `last_capacity_confirmed`, and the entire
  `CapacityChecks` log

**Not in this repository at all.** No partner records, contacts, spreadsheet IDs, or
server-side keys are committed. The Places API key lives in an Apps Script **Script
Property** (`PLACES_API_KEY`), not in source. The only sample data committed is
[`reference/events-sample.csv`](reference/events-sample.csv), which is the public event
map's own already-published event data.

> **One credential to rotate.** `src/index.html` contains a referrer-restricted Google
> **Maps JavaScript** API key in `FALLBACK_KEY`. A Maps JS key is a client-side key —
> it is visible in every visitor's browser, and its real protection is the HTTP-referrer
> restriction (locked to the site's domain), not secrecy. It was committed when this
> repo was private; because the repo is now public, **rotate the key** in Google Cloud
> Console and confirm its referrer allowlist is tight. It is not an emergency, but it is
> the right hygiene.

## Tech stack

- **Database:** Google Sheets (a separate workbook from the public Events sheet).
- **Admin app:** Google Apps Script (V8) via [`clasp`](https://github.com/google/clasp),
  bound to the workbook (`apps-script/`).
- **Public map:** a single static `src/index.html` — Google Maps JavaScript API +
  [PapaParse](https://www.papaparse.com/) (CDN), no build step — on Cloudflare Pages.
- **Pantry seeding:** Google Places API (New), called server-side from Apps Script.

No Supabase, Airtable, or Salesforce — this is the lightweight "Tier A" build that
reuses the event map's proven stack.

## Repository layout

```
.
├── AGENTS.md              # Canonical agent/context notes (CLAUDE.md is just @AGENTS.md)
├── PRD.md                 # Product requirements — the what & why
├── CHANGELOG.md           # Build history
├── apps-script/           # clasp project — the bound Apps Script admin app
│   ├── appsscript.json    # Manifest: scopes for sheets, geocoder/UrlFetch, UI, mail, forms
│   ├── Code.gs            # All admin logic (setup, partners, links, reminders, triggers, public view)
│   ├── AddPartnerDialog.html / EditPartnerDialog.html
│   ├── LinkPartnerDialog.html / ViewLinksDialog.html
│   ├── RunCapacityCheckDialog.html / ViewCapacityStatusDialog.html
│   ├── FindPantriesDialog.html
│   └── .clasp.json.example  # Copy to .clasp.json and add your scriptId (gitignored)
├── docs/
│   ├── DATA_MODEL.md      # Column-by-column schema (the contract)
│   ├── PUBLIC_MAP.md      # Public-map deploy guide (published CSVs + Cloudflare Pages)
│   └── SMOKE_TEST.md      # Manual end-to-end checklist (run after clasp push)
├── reference/
│   └── events-sample.csv  # Read-only sample of the public event-map schema
├── src/
│   └── index.html         # Public distribution map (reads the three published CSVs)
└── .githooks/
    └── post-commit        # Optional auto-push hook
```

## Getting started

This project has two independently runnable surfaces. Neither needs a build step.

### The public map (`src/index.html`)

The map is a single static file. To run it locally you need a Maps JavaScript API key
and the three published CSV URLs.

```sh
# from the repo root
python3 -m http.server 8000      # then open http://localhost:8000/src/index.html?k=YOUR_MAPS_KEY
```

- Pass a Maps key with `?k=YOUR_MAPS_KEY` (overrides the committed `FALLBACK_KEY`).
- The CSV URLs are set in the `CONFIG` block near the top of the inline `<script>`.
  Generate the tabs with **FTC ▸ Rebuild public view**, publish them to web as CSV, and
  paste the URLs in. Full instructions: [`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).

### The Apps Script back office (`apps-script/`)

The app is bound to a Google Sheets workbook and deployed with `clasp`. `.clasp.json`
(which holds the `scriptId`) is gitignored, so a fresh clone re-binds:

```sh
npm install -g @google/clasp
clasp login
cd apps-script
clasp clone <scriptId>     # scriptId comes from the project owner
clasp push                 # deploy Code.gs + the dialogs + appsscript.json
```

Then, in the sheet: **FTC ▸ Set up sheets** builds the tabs and installs the daily
triggers (approve the auth prompt on first run). The full **FTC** menu adds Add/Edit
Partner, Refresh Events, Link Partner to Event(s), View Links, Send Reminders Now, Send
Reminder for One Event, View Capacity Status, Find Nearby Pantries, Seed Pantries
(Places), and Rebuild public view.

For **Seed Pantries**, add a server-side Google Places API (New) key in
**Project Settings ▸ Script Properties ▸ `PLACES_API_KEY`** (optional overrides:
`PLACES_RADIUS_MILES`, `PLACES_MAX_PER_EVENT`).

Verify a deployment end to end with [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md).

## Deploy & demo

- **Public map:** deployed as its own Cloudflare Pages project (serving the `src/`
  directory) at **https://ftc-distribution-tool.pages.dev/**. A push to `main`
  auto-redeploys. Setup details: [`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md).
- **Back office:** there is no public deployment — it runs inside the bound Google
  Sheets workbook for signed-in admins.

## Documentation

| File | What's in it |
|---|---|
| [`PRD.md`](PRD.md) | Product requirements: problem, scope, architecture, workflows, compliance. |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Column-by-column schema for every tab (the contract). |
| [`docs/PUBLIC_MAP.md`](docs/PUBLIC_MAP.md) | Deploy guide for the public map. |
| [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) | Manual end-to-end test checklist. |
| [`CHANGELOG.md`](CHANGELOG.md) | Build history. |
| [`AGENTS.md`](AGENTS.md) | Context notes for AI coding agents. |

## Brand

- Orange `#FF6500`
- Navy `#003366`

## Contributing

Small, reviewable steps; smoke-test after each change; commit with a conventional
message (`feat:`, `fix:`, `docs:`…) and keep [`CHANGELOG.md`](CHANGELOG.md) current. A
tracked `post-commit` hook can auto-push — enable it per clone with
`git config core.hooksPath .githooks`.

## License

No license file is present yet, so the default applies: **all rights reserved**. If
this should be openly reusable, add a license (e.g. MIT or Apache-2.0); if it should
stay closed, an explicit proprietary notice is worth adding. This is a decision for the
project owner.
