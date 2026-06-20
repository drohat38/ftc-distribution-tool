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
1. **Privacy wall (scoped — see Phase 3b carve-out).** Contact fields
   (`contact_name` / `contact_phone` / `contact_email`), `agreement_on_file`,
   `agreement_date`, and `last_verified` are internal and are NEVER written to a
   published CSV or served on a public URL.
   **Phase 3b carve-out (decided 2026-06-19):** Dev explicitly chose to publish a
   NON-CONTACT subset of partner data to drive a public distribution map — org
   name, city, address, lat/long, `pathway`, `cold_storage`,
   `monthly_capacity_meals`, `recurring_slot`, `partnership_status`, plus the
   event↔partner links (`PartnerID`/`EventID`/`active`). These come from the
   auto-generated `Partners_Public` / `Links_Public` tabs ONLY (built by
   `Rebuild public view`). Never widen that column set to include a contact /
   agreement / verification field. The public event map still uses its own
   published Events CSV for its Events tab.
2. **Separate workbook.** Partners + Links live in their OWN Google Sheets
   workbook, not in the public Events sheet. The public event map's workbook
   must never contain partner data.
3. **Don't touch the map repo.** The event-map repo is READ-ONLY reference for
   its Apps Script patterns (schema, geocoding, status). Never modify it.
4. **Required food-safety fields.** Every partner record MUST have `pathway`
   (`same-day` | `hold-redistribute`) and `cold_storage`. The hold pathway
   legally requires cold storage (see `PRD.md` compliance section).
   **Phase 5 carve-out (seeded candidates).** Places-seeded `candidate` rows
   (`source = places`, blank `last_verified`) may carry these BLANK — they're
   unverified leads, never auto-promoted to active. The gate is enforced at the
   point of trust: **Edit Partner** rejects a save without a valid `pathway` +
   `cold_storage`, so a candidate must be qualified before it's activated or
   relied on. Don't fabricate a pathway for a lead.

## Stack (reuse the event map's proven patterns)
- **Database:** Google Sheets (separate workbook).
- **Admin app:** Google Apps Script via `clasp`, running inside the sheet.
  Reuse the event map's geocoding + status logic.
- **Private admin map (PRD §4):** an Apps Script web app, gated by Google
  sign-in, reads Partners + Links server-side. Still the model for the full
  internal view (contacts included).
- **Public distribution map (Phase 3b, decided 2026-06-19):** a self-contained
  `src/index.html` on its OWN Cloudflare Pages project (separate from the event
  map), reading the published `Partners_Public` / `Links_Public` /
  `Events_Reference` CSVs by URL — no auth, no Sheets API. Only the non-contact
  subset (rule #1 carve-out) is ever published. Reuses the event map's
  referrer-restricted Maps JS key (add this project's `*.pages.dev` URL to its
  referrers; pass via `?k=` or `FALLBACK_KEY`).
- **Pantry seeding (Phase 5):** `Seed Pantries` queries the Google Places API
  (New) server-side for food pantries/banks/soup kitchens near each event and
  appends them as `candidate` rows. Its key is a SEPARATE server-side key in the
  `PLACES_API_KEY` Script Property — NOT the public map's referrer-restricted
  browser key, and never hardcoded in source.
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
