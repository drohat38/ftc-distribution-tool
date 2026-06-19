/**
 * FTC Distribution Tool — Apps Script entry point (SCAFFOLD ONLY).
 *
 * Internal partner-distribution tool for Feed the City (Tango Charities).
 * Runs bound to the separate Partners + Links Google Sheets workbook — NOT the
 * public event-map workbook. See AGENTS.md and PRD.md.
 *
 * Privacy wall: partner data is internal. Never write it to a published CSV and
 * never serve it on a public URL. The private map is a Google-sign-in-gated
 * Apps Script web app that reads Partners + Links server-side.
 *
 * No features yet. Build phases (PRD.md §10):
 *   2. Partners tab + admin app  — schema, add/edit dialogs, geocoding, status
 *   3. EventPartnerLinks + private map — the join, the web app, event↔partner lines
 *   4. Capacity-check workflow   — pre-event confirmation + backup list
 *
 * Reuse the event map's proven geocoding + status patterns (read-only reference
 * repo — never modify it).
 */
