# FTC Distribution Tool — Agent Context

> Canonical context file. Read this every session. Both Claude Code and
> Antigravity read `AGENTS.md`. `CLAUDE.md` is just `@AGENTS.md`.
> Full product spec is in `PRD.md`. Keep this file under 200 lines.

## What this is
Internal **partner-distribution tool** for Feed the City (Tango Charities).

It is the SIBLING of the public event map
(`github.com/drohat38/feed-the-city-event-map`):
- The event map shows where food is **made** — public, volunteer-facing.
- THIS tool maps where food **goes** — the partner orgs that receive it. **Internal.**

The two link by `EventID` (the event map already uses stable UUIDs — see
`reference/events-sample.csv`).

## Hard rules (non-negotiable)
1. **Privacy wall.** Partner data (contacts, capacity, who-receives-what) is
   internal. It is NEVER written to a published CSV and NEVER served on a public
   URL. Only the public event map uses a published CSV, and only for its own
   Events tab.
2. **Separate workbook.** Partners + Links live in their OWN Google Sheets
   workbook, not in the public Events sheet. The public event map's workbook
   must never contain partner data.
3. **Don't touch the map repo.** The event-map repo is READ-ONLY reference for
   its Apps Script patterns (schema, geocoding, status). Never modify it.
4. **Required food-safety fields.** Every partner record MUST have `pathway`
   (`same-day` | `hold-redistribute`) and `cold_storage`. The hold pathway
   legally requires cold storage (see `PRD.md` compliance section).

## Stack (reuse the event map's proven patterns)
- **Database:** Google Sheets (separate workbook).
- **Admin app:** Google Apps Script via `clasp`, running inside the sheet.
  Reuse the event map's geocoding + status logic.
- **Private map:** an Apps Script **web app**, gated by Google sign-in. Reads
  Partners + Links server-side. (NOT a public Cloudflare Pages site. If
  Cloudflare is used, it must sit behind Cloudflare Access.)
- Do NOT introduce Supabase, Airtable, or Salesforce. This is the Tier A build.

## Data model (detail in `docs/DATA_MODEL.md`)
- **Partners** — `PartnerID` (UUID); HSDS fields (organization / location /
  service / contact) + FTC fields. `pathway` and `cold_storage` REQUIRED.
  `monthly_capacity_meals`, `recurring_slot`, `partnership_status`,
  `assigned_chapter`, `agreement_on_file`, `last_verified`.
- **EventPartnerLinks** — join of `EventID` <-> `PartnerID`. **MANY-TO-MANY**:
  one event can have several partners; one partner can serve several events.
  Per-link fields: `active`, `recurring_slot`, `last_capacity_confirmed`.
- Geocode each partner address ONCE; store lat/long in the sheet (like Events).
  Never re-geocode on map load.

## Brand
- Orange `#FF6500`, Navy `#003366`.

## Git workflow
- After each change that passes a smoke test: stage all, commit with a clear
  conventional message (`feat:`, `fix:`, `docs:`…), push to `origin/main`.
- A `post-commit` hook auto-pushes, so committing is enough.
- Keep `CHANGELOG.md` current with every meaningful change.

## Working discipline
- Scaffold before building. Confirm structure with the human before features.
- Small, reviewable steps. Smoke-test after each.
- `PRD.md` is the source of truth for WHAT to build and WHY.
