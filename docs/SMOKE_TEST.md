# Human smoke-test checklist

These steps need a real Google account, the bound Apps Script project, and a Places
API key — they **cannot** be verified from the build environment. Run them once
after `clasp push` to confirm the finish-the-app build works end to end.

## 0. Deploy + one-time setup

- [ ] `cd apps-script && clasp push` (deploys `Code.gs` + the dialogs).
- [ ] Reload the sheet. **FTC ▸ Set up sheets.** Approve the auth prompt (it now
      also needs the *ScriptApp* scope to install triggers). Confirm the alert says
      the `Partners`, `EventPartnerLinks`, `Leaders`, and `CapacityChecks` tabs are
      ready and that triggers were installed.
- [ ] **Extensions ▸ Apps Script ▸ Triggers** shows **two** time-driven triggers:
      `refreshEvents` (daily) and `sendLeaderReminders` (daily).
- [ ] Fill the **Leaders** tab with at least one row whose `leader_name` first word
      matches an event's `Leader` (e.g. `Deven`), a real `leader_email` you can
      check, and `active = TRUE`.
- [ ] **FTC ▸ Refresh Events.** The `Events_Reference` tab now has `Saturday`,
      `Time`, and `Leader` columns populated.

## 1. Places seeding wrote candidates, dedup skipped the real partners

- [ ] In the Apps Script editor: **Project Settings ▸ Script Properties ▸** add
      `PLACES_API_KEY` (a server-side Places API (New) key, **not** referrer-locked).
- [ ] Make sure a couple of your ~50 real active partners exist in `Partners` first.
- [ ] **FTC ▸ Seed Pantries (Places).** The alert reports *N candidates added* and
      *M skipped as duplicates*.
- [ ] In `Partners`, the new rows have `partnership_status = candidate`,
      `source = places`, **blank** `last_verified`, **blank** `pathway` /
      `cold_storage`, and a populated address / lat-long / phone / hours.
- [ ] **Dedup check:** a real active partner that Places also returns (same name,
      same spot) was **not** re-added as a candidate (it's in the "skipped" count).

## 2. A leader reminder email arrives with a working prefilled link

- [ ] In **FTC ▸ Link Partner to Event(s)**, pick an active partner with a
      `contact_email`, select an event **whose leader you set in step 0**, check
      **Primary**, and save. **FTC ▸ View Links** (by event) shows a **primary** badge.
- [ ] **FTC ▸ Send Reminder for One Event.** Pick that event — the dialog shows the
      resolved **leader** and **primary partner**; the date defaults to the next
      occurrence. Send. (Or use **Send Reminders Now** if the event is ~7 days out.)
- [ ] The **leader's** inbox (not the partner's) gets the reminder: it names the
      event + date, shows the primary partner's contact, and contains a copyable
      template with a **prefilled form link**.
- [ ] Open that link → the Google Form opens with the **Reference code** field
      pre-filled. (Don't edit it.)

## 3. Submitting the form logs to CapacityChecks

- [ ] Submit the form: choose **Yes** and type a meal number (e.g. `150`).
- [ ] In `CapacityChecks`, the matching row (same `CheckID`) flips to
      `Status = confirmed`, `ConfirmedMeals = 150`, and gets a `ResponseTimestamp`.
- [ ] The matching `EventPartnerLinks` row's `last_capacity_confirmed` is stamped.
- [ ] **FTC ▸ View Capacity Status** shows the partner's confirmed number — with
      **no expected total and no shortfall** (the app reports; the leader decides).

## 4. Find Nearby Pantries returns sorted results (+ backup link)

- [ ] **FTC ▸ Find Nearby Pantries.** Pick an event with coordinates. Results are
      the nearest **candidate + active** partners **not already linked**, sorted by
      distance (closest first), each with distance, pathway, cold storage, capacity,
      and contact.
- [ ] Click **Get backup form link** on one result → a prefilled URL + copyable
      template appear, and a new `sent` row shows up in `CapacityChecks` for that
      partner.

## 5. The map shows gray vs colored pins + event→partner lines, no contacts in CSVs

- [ ] **FTC ▸ Rebuild public view**, then publish `Partners_Public`, `Links_Public`,
      and `Events_Reference` to web as CSV (File ▸ Share ▸ Publish to web). Paste the
      URLs into `CONFIG` in `src/index.html` and deploy to Cloudflare Pages.
- [ ] On the map: **event pins** (navy), **active partners colored** by pathway
      (orange same-day / teal hold), **candidate pantries gray**, and a **line** from
      each event to every partner it's linked to.
- [ ] The legend **Show candidate pantries** checkbox hides/shows the gray pins (and
      their lines); the count badge updates.
- [ ] **Privacy check:** open each published CSV URL directly — `Partners_Public`
      and `Links_Public` contain **no** `contact_*`, `agreement_*`, or
      `last_verified` columns.
