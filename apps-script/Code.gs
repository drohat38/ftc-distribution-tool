/**
 * FTC Distribution Tool — Apps Script admin.
 *
 * Bound to the PRIVATE "FTC Distribution (Partners)" workbook — a separate
 * workbook from the public event-map Events sheet (the privacy wall). See
 * AGENTS.md and PRD.md.
 *
 * Phase 2a — data foundation:
 *   - "Set up sheets" creates the Partners and EventPartnerLinks tabs with the
 *     exact header rows from docs/DATA_MODEL.md, brand-styled headers, dropdown
 *     validation (pathway / cold_storage / partnership_status), and the
 *     agreement_on_file checkbox.
 *   - A simple onEdit trigger auto-fills PartnerID / LinkID with a UUID when a
 *     new row gains content.
 *
 * Phase 2b — Add / Edit Partner with geocoding (this file's add/edit half):
 *   - "Add Partner" / "Edit Partner" open HTML dialogs (AddPartnerDialog.html /
 *     EditPartnerDialog.html).
 *   - addPartner(): generates the UUID PartnerID, geocodes the address to
 *     lat/long ONCE (Apps Script's keyless Maps geocoder — never the public
 *     map's Maps JS key), stamps FirstAdded + last_verified, appends the row,
 *     and enforces the required pathway / cold_storage food-safety fields.
 *   - updatePartner(): updates a row by PartnerID, refreshes last_verified, and
 *     re-geocodes ONLY when the address changed.
 *
 * Phase 3a — link partners to events (the many-to-many join):
 *   - "Refresh Events" fetches the PUBLIC event-map's published Events CSV
 *     (CONFIG.EVENTS_CSV_URL — the same URL the public map reads) and mirrors
 *     EventID + public display fields into a read-only Events_Reference tab.
 *     READ-ONLY: we only ever fetch this; we never write back to the public
 *     sheet, and no partner data ever flows outward (privacy wall).
 *   - "Link Partner to Event(s)" opens a dialog to pick one partner and
 *     multi-select one or more events; linkPartnerToEvents() UPSERTS into
 *     EventPartnerLinks (one row per pair) — updating the existing row when a
 *     PartnerID+EventID pair already exists rather than duplicating it.
 *   - "View Links" lists a partner's linked events, or an event's linked
 *     partners (both directions of the join).
 *
 * Geocoding reuses the event-map pattern verbatim: Maps.newGeocoder()
 * .setRegion('us').geocode(query). Cached in latitude/longitude, never
 * recomputed on map load (PRD §5).
 *
 * Schema is driven entirely by CONFIG.SHEETS below; the header arrays MUST stay
 * in lockstep with docs/DATA_MODEL.md (that file is the contract).
 *
 * Idioms (menu, headerMap_, withLock_, Utilities.getUuid, requireValueInList,
 * fillCoordinates_/validLatLng_) mirror the proven event-map Apps Script —
 * read-only reference at reference/feed-the-city-event-map/. Never modify it.
 */

const CONFIG = {
  MENU: 'FTC',
  COLORS: {
    HEADER_BG: '#FF6500',   // brand orange
    HEADER_TEXT: '#FFFFFF',
    NAVY: '#003366'         // brand navy (reserved for accents)
  },

  // The PUBLIC event-map's published Events CSV (read-only). This is the SAME
  // URL the public map fetches (reference/feed-the-city-event-map/src/index.html,
  // const CSV). Events data is already public; we only ever READ it to mirror it
  // into the read-only Events_Reference tab so partner links have something to
  // join against. We NEVER write back to it, and partner data never flows the
  // other way (privacy wall — AGENTS.md rule #1/#2).
  EVENTS_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSYstAMLbxJyPYit_JRhg1mHFhD_EIsM4Znp8Joy_cY5fhNOlZOI4p-lC2VomCKM4S5mTcemkZiAcDM/pub?gid=0&single=true&output=csv',

  // The local read-only mirror of the public Events sheet. Managed entirely by
  // refreshEvents() — never hand-edited, never an auto-UUID tab (kept out of
  // SHEETS so setupSheets()/onEdit leave it alone). Headers are a subset of the
  // public Events CSV, named identically so we can map straight across. All
  // columns here are already-public event fields — no partner data.
  EVENTS_REF: {
    name: 'Events_Reference',
    idColumn: 'EventID',
    // `Saturday` (which Saturday of the month) and `Leader` (chapter-leader first
    // name) were added in Section 1: `Saturday` drives the next-occurrence date in
    // the leader reminder workflow, and `Leader` is matched to the Leaders tab to
    // resolve who to remind. `Time` is mirrored for the reminder email. All three
    // are already-PUBLIC event fields (the event map publishes them) — no partner
    // data, so the privacy wall is unaffected.
    headers: [
      'EventID', 'City', 'State', 'Venue', 'Address',
      'Saturday', 'Time', 'Leader',
      'Status', 'Paused', 'Latitude', 'Longitude'
    ]
  },

  // Phase 3b — the PUBLIC view. "Rebuild public view" regenerates these two tabs
  // from the private Partners + EventPartnerLinks tabs; the human then publishes
  // each to web as CSV (File ▸ Share ▸ Publish to web ▸ that tab ▸ CSV) so the
  // public Cloudflare map can read them by URL.
  //
  // SCOPED OVERRIDE OF THE PRIVACY WALL (decided 2026-06-19; see CHANGELOG /
  // AGENTS.md rule #1). Only the NON-CONTACT subset below is ever published.
  // The contact fields (contact_name / contact_phone / contact_email),
  // agreement_on_file, agreement_date, and last_verified are DELIBERATELY
  // EXCLUDED — they stay only in the private Partners tab and are never published.
  // Links_Public carries only PartnerID/EventID/active — last_capacity_confirmed
  // and per-link recurring_slot stay internal (defense in depth).
  PUBLIC: {
    PARTNERS: {
      name: 'Partners_Public',
      headers: [
        'PartnerID', 'organization_name', 'city', 'address',
        'latitude', 'longitude', 'pathway', 'cold_storage',
        'monthly_capacity_meals', 'recurring_slot', 'partnership_status'
      ]
    },
    LINKS: {
      name: 'Links_Public',
      headers: ['PartnerID', 'EventID', 'active']
    }
  },

  // Tab specs. `headers` order MUST match docs/DATA_MODEL.md exactly.
  SHEETS: {
    PARTNERS: {
      name: 'Partners',
      idColumn: 'PartnerID',
      headers: [
        'PartnerID', 'organization_name', 'description', 'website',
        'address', 'city', 'state', 'postal_code', 'latitude', 'longitude',
        'service_name', 'contact_name', 'contact_phone', 'contact_email',
        'pathway', 'cold_storage', 'monthly_capacity_meals', 'recurring_slot',
        'partnership_status', 'assigned_chapter', 'agreement_on_file',
        'agreement_date', 'last_verified', 'FirstAdded', 'source', 'hours'
      ],
      required: ['PartnerID', 'organization_name', 'address', 'pathway', 'cold_storage'],
      dropdowns: {
        pathway: ['same-day', 'hold-redistribute'],
        cold_storage: ['yes', 'no'],
        partnership_status: ['candidate', 'active', 'paused']
      },
      checkboxes: ['agreement_on_file']
    },
    LINKS: {
      name: 'EventPartnerLinks',
      idColumn: 'LinkID',
      // `is_primary` (Section 1): exactly ONE link per EventID is the primary
      // (Nick's first/default partner); the rest are backups. The Link dialog
      // marks one link per event as primary and demotes the others so the
      // one-primary-per-event invariant holds.
      headers: [
        'LinkID', 'EventID', 'PartnerID', 'active',
        'recurring_slot', 'last_capacity_confirmed', 'is_primary'
      ],
      required: ['LinkID', 'EventID', 'PartnerID', 'active'],
      dropdowns: {},
      // `active` + `is_primary` are checkboxes, written as real booleans by the
      // link dialog upsert (DATA_MODEL.md Tab 2).
      checkboxes: ['active', 'is_primary']
    },

    // Section 1 — chapter leaders. One row per leader; the reminder workflow
    // (Section 2) matches an event's `Leader` first-name here to find who to
    // remind and at what email. No idColumn (no auto-UUID) — the email is the
    // natural key. Created by "Set up sheets"; onEdit leaves it alone (no idColumn).
    LEADERS: {
      name: 'Leaders',
      headers: ['leader_name', 'leader_email', 'chapter', 'active', 'notes'],
      required: ['leader_name', 'leader_email'],
      dropdowns: {},
      checkboxes: ['active']
    },

    // Phase 4 (corrected in Phase 5) — pre-event capacity check log. One row per
    // (event, date, partner) ask. Created with Status='sent' by runCapacityCheck()
    // and updated to confirmed/declined by the Google Form submit trigger
    // (onCapacityFormSubmit). ConfirmedMeals holds the partner's own number from
    // their response. The app does NOT set an expected total or compute a
    // shortfall — the leader reads the confirmed numbers and decides if it's
    // enough (Phase 5 removed the split/deficit logic). RequestedMeals is retained
    // for schema/back-compat but is no longer auto-filled. Contact info lives only
    // in Partners; this tab never stores it, and is internal-only (never part of
    // the published public view).
    CAPACITY: {
      name: 'CapacityChecks',
      idColumn: 'CheckID',
      headers: [
        'CheckID', 'EventID', 'PartnerID', 'EventDate', 'RequestedMeals',
        'ConfirmedMeals', 'Status', 'SentTimestamp', 'ResponseTimestamp'
      ],
      required: ['CheckID', 'EventID', 'PartnerID'],
      dropdowns: {
        Status: ['sent', 'confirmed', 'declined', 'no-response']
      },
      checkboxes: []
    }
  }
};

// Phase 4 — ScriptProperties keys for the reusable capacity-check Google Form.
// The form is created once (lazily) and reused for every check; responses route
// back to CapacityChecks by CheckID via an installable onFormSubmit trigger.
const CAPACITY_PROPS = {
  FORM_ID: 'CAPACITY_FORM_ID',
  PUBLISHED_URL: 'CAPACITY_FORM_PUBLISHED_URL',
  ITEM_CHECKID: 'CAPACITY_ITEM_CHECKID',  // short-text item we prefill per partner
  ITEM_YESNO: 'CAPACITY_ITEM_YESNO',      // Yes/No multiple choice
  ITEM_MEALS: 'CAPACITY_ITEM_MEALS'       // ConfirmedMeals short text (number)
};
// Stable titles for the form items (used as a fallback match if a stored item id
// is ever missing). Keep in sync with ensureCapacityForm_.
const CAPACITY_FORM_TITLES = {
  CHECKID: 'Reference code (please do not edit)',
  YESNO: 'Can your organization take this food?',
  MEALS: 'Roughly how many meals can you take?'
};
const CAPACITY_TRIGGER_FN = 'onCapacityFormSubmit';

// Section 2 — leader reminder workflow. The system reminds the EVENT'S LEADER
// (never the partner directly) about a week before each event's next occurrence;
// the leader forwards the partner a prefilled form link, and the partner's
// response still logs to CapacityChecks. REMINDER_LEAD_DAYS is the window: an
// event is reminded when its next occurrence is within this many days. The daily
// trigger (ensureReminderTrigger_) fires sendLeaderReminders automatically; a
// per-(event,occurrence) dedupe in ScriptProperties stops a leader being
// reminded twice for the same date.
const REMINDER_LEAD_DAYS = 7;
const REMINDER_TRIGGER_FN = 'sendLeaderReminders';
const REMINDER_TRIGGER_HOUR = 7;                 // daily, ~7am script timezone
const REMINDER_PROPS = { SENT: 'LEADER_REMINDERS_SENT' };

// Section 3 — auto-refresh the Events_Reference mirror daily so it stays current
// without anyone clicking (ensureRefreshTrigger_). Fires before the reminder
// trigger (hour 5 vs 7) so reminders run against fresh events.
const REFRESH_TRIGGER_FN = 'refreshEvents';
const REFRESH_TRIGGER_HOUR = 5;

// Phase 5 — "Find Nearby Pantries" recommender. How many nearest partners (from
// the full candidate+active universe) the leader-initiated recommender returns.
const FIND_PANTRIES_LIMIT = 20;

// Phase 5 — Google Places seeding config. The Places API key is a SEPARATE
// server-side key — NOT the referrer-restricted browser Maps key the public map
// uses. It is read from Script Properties so it never lands in source / git.
// Set it in the Apps Script editor: Project Settings ▸ Script Properties ▸ add
// PLACES_API_KEY. RADIUS_MILES / MAX_PER_EVENT are optional overrides.
const PLACES_PROPS = {
  API_KEY: 'PLACES_API_KEY',
  RADIUS_MILES: 'PLACES_RADIUS_MILES',
  MAX_PER_EVENT: 'PLACES_MAX_PER_EVENT',
  // Resume cursor: EventIDs already seeded in the current pass (so a big seed that
  // can't finish in one 6-min execution continues where it left off on re-run).
  SEEDED_EVENTS: 'PLACES_SEEDED_EVENTS'
};
const PLACES_DEFAULTS = { RADIUS_MILES: 15, MAX_PER_EVENT: 20 };
// Stop searching new events past this wall-clock budget and flush what we have,
// leaving headroom under Apps Script's ~6-min execution cap. Re-run to continue.
const PLACES_TIME_BUDGET_MS = 270000; // 4.5 min
// Search terms run per event (Places Text Search, New); merged + deduped by id.
const PLACES_QUERIES = ['food pantry', 'food bank', 'soup kitchen'];
// A candidate within this many miles of an existing partner of the same
// normalized name counts as a duplicate and is skipped.
const PLACES_DUP_MILES = 0.1;

/**
 * Build the "FTC" menu. Add / Edit Partner open the qualify-and-geocode dialogs;
 * "Set up sheets" stays as the one-time setup / repair entry point.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(CONFIG.MENU)
    .addItem('Add Partner', 'openAddPartnerDialog')
    .addItem('Edit Partner', 'openEditPartnerDialog')
    .addSeparator()
    .addItem('Refresh Events', 'refreshEvents')
    .addItem('Link Partner to Event(s)', 'openLinkPartnerDialog')
    .addItem('View Links', 'openViewLinksDialog')
    .addSeparator()
    .addItem('Send Reminders Now', 'sendLeaderReminders')
    .addItem('Send Reminder for One Event…', 'openRunCapacityCheckDialog')
    .addItem('View Capacity Status', 'openViewCapacityStatusDialog')
    .addItem('Find Nearby Pantries', 'openFindPantriesDialog')
    .addSeparator()
    .addItem('Seed Pantries (Places)', 'seedPantries')
    .addItem('Rebuild public view', 'rebuildPublicView')
    .addSeparator()
    .addItem('Set up sheets', 'setupSheets')
    .addToUi();
}

/**
 * Create / repair the Partners and EventPartnerLinks tabs.
 * Idempotent: re-running rewrites headers, formatting, and validation without
 * touching existing data rows or once-assigned IDs.
 */
function setupSheets() {
  withLock_(function() {
    Object.keys(CONFIG.SHEETS).forEach(function(key) {
      setupOneSheet_(CONFIG.SHEETS[key]);
    });
    removeDefaultSheetIfEmpty_();
  });

  // Install / repair the daily automation triggers (Sections 2 & 3). Each ensure
  // is idempotent, so re-running Set up sheets is safe. Installing time triggers
  // needs the ScriptApp scope, which the user grants by running this from the menu.
  ensureRefreshTrigger_();
  ensureReminderTrigger_();

  SpreadsheetApp.getUi().alert(
    'Sheets ready',
    'The "Partners", "EventPartnerLinks", "Leaders", and "CapacityChecks" tabs ' +
    'are set up with headers, dropdowns, checkboxes, and auto-UUID.\n\n' +
    'Add a row on Partners / EventPartnerLinks / CapacityChecks and its ID fills ' +
    'in automatically. pathway, cold_storage, partnership_status, and Status are ' +
    'dropdowns. Fill the Leaders tab (leader_name, leader_email, chapter, active) ' +
    'so leader reminders know who to email.\n\n' +
    'Daily auto-triggers for Refresh Events and leader reminders were installed ' +
    '(re-run this any time to repair them).',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Partner — dialogs (Phase 2b)
// ---------------------------------------------------------------------------

/** Open the Add Partner dialog (the qualify-and-geocode form). */
function openAddPartnerDialog() {
  const html = HtmlService.createHtmlOutputFromFile('AddPartnerDialog')
    .setWidth(560).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Distribution Partner');
}

/**
 * Open the Edit Partner dialog.
 *
 * - From the menu with no argument: edits whatever row is active on the
 *   Partners tab.
 * - With a rowNumber: edits that specific row.
 * Bails with a friendly alert if no real partner row is selected.
 */
function openEditPartnerDialog(rowNumber) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const sheet = getOrCreateSheet_(spec.name);
  const row = Number(rowNumber) || getActivePartnerRow_();
  if (!row) {
    SpreadsheetApp.getUi().alert('Select a partner row on the "Partners" tab first, then choose Edit Partner.');
    return;
  }
  if (row < 2 || row > sheet.getLastRow()) {
    SpreadsheetApp.getUi().alert('That row no longer exists. Pick a partner row on the "Partners" tab and try again.');
    return;
  }
  const template = HtmlService.createTemplateFromFile('EditPartnerDialog');
  template.rowNumber = row;
  const html = template.evaluate().setWidth(560).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Edit Distribution Partner');
}

/**
 * Append a new partner row.
 *
 * On submit: enforce required food-safety fields (pathway + cold_storage, and
 * the hold-pathway → cold-storage gate), generate the UUID PartnerID, geocode
 * the address ONCE to lat/long (skipped if valid coordinates were supplied),
 * default partnership_status to "candidate", and stamp FirstAdded +
 * last_verified to now. Returns a small result the dialog renders.
 */
function addPartner(data) {
  return withLock_(function() {
    const spec = CONFIG.SHEETS.PARTNERS;
    const sheet = getOrCreateSheet_(spec.name);
    ensurePartnerHeaders_(sheet);

    const draft = normalizePartnerDraft_(data || {});
    const errors = validatePartnerDraft_(draft);
    if (errors.length) throw new Error(errors.join(' '));

    if (!String(draft.PartnerID || '').trim()) draft.PartnerID = Utilities.getUuid();
    if (!String(draft.partnership_status || '').trim()) draft.partnership_status = 'candidate';

    // Geocode once. fillPartnerCoordinates_ skips if valid lat/long are already
    // present (the "skip if already present" rule), so re-saves don't re-hit
    // the geocoder.
    const geo = fillPartnerCoordinates_(draft);

    const now = new Date();
    draft.FirstAdded = now;
    draft.last_verified = now;

    const nextRow = sheet.getLastRow() + 1;
    writePartnerRow_(sheet, nextRow, draft);

    return {
      rowNumber: nextRow,
      partnerId: draft.PartnerID,
      geocoded: geo.ok,
      lat: draft.latitude,
      lng: draft.longitude,
      geoMessage: geo.ok ? '' : geo.message
    };
  });
}

/**
 * Update an existing partner row by row number (its PartnerID is preserved).
 *
 * Refreshes last_verified on every save (PRD §8). Re-geocodes ONLY when the
 * address signature changed; otherwise the cached lat/long carry over untouched
 * (no geocoder call). PartnerID and FirstAdded are immutable — read back from
 * the existing row so the form can't blank them.
 */
function updatePartner(rowNumber, data) {
  return withLock_(function() {
    const spec = CONFIG.SHEETS.PARTNERS;
    const sheet = getOrCreateSheet_(spec.name);
    const row = Number(rowNumber);
    if (!row || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid row number.');

    const existing = readPartnerRow_(sheet, row);
    const draft = normalizePartnerDraft_(data || {});
    const errors = validatePartnerDraft_(draft);
    if (errors.length) throw new Error(errors.join(' '));

    // Immutable identity / creation date carry over from the stored row.
    draft.PartnerID = String(existing.PartnerID || '').trim() || draft.PartnerID || Utilities.getUuid();
    draft.FirstAdded = existing.FirstAdded || draft.FirstAdded || '';

    // Provenance + hours aren't managed by the Edit dialog (Phase 5) — preserve
    // them from the stored row so editing a seeded candidate never blanks them.
    if (!String(draft.source || '').trim()) draft.source = existing.source || '';
    if (!String(draft.hours || '').trim()) draft.hours = existing.hours || '';

    const addressChanged = partnerAddressSig_(draft) !== partnerAddressSig_(existing);
    if (addressChanged) {
      // Address moved — drop the stale pin so fillPartnerCoordinates_ re-geocodes.
      draft.latitude = '';
      draft.longitude = '';
    } else if (!validLatLng_(draft.latitude, draft.longitude)) {
      // Address unchanged — keep the cached coordinates (the form omits them).
      draft.latitude = existing.latitude;
      draft.longitude = existing.longitude;
    }

    const geo = fillPartnerCoordinates_(draft);
    draft.last_verified = new Date();

    writePartnerRow_(sheet, row, draft);

    return {
      rowNumber: row,
      partnerId: draft.PartnerID,
      reGeocoded: addressChanged,
      geocoded: geo.ok,
      lat: draft.latitude,
      lng: draft.longitude,
      geoMessage: geo.ok ? '' : geo.message
    };
  });
}

/**
 * Read one partner row for the Edit dialog. Every field is String()-ified
 * because google.script.run can't serialize Date objects (last_verified /
 * FirstAdded / agreement_date) — the same gotcha the event-map hit. The dialog
 * only reads these into form controls, so strings are fine.
 */
function getPartnerForEdit(rowNumber) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const sheet = getOrCreateSheet_(spec.name);
  const row = Number(rowNumber);
  if (!row || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid row number.');

  const raw = readPartnerRow_(sheet, row);
  const data = {};
  Object.keys(raw).forEach(function(k) {
    data[k] = (raw[k] === null || raw[k] === undefined) ? '' : String(raw[k]);
  });
  return { rowNumber: row, data: data };
}

// ---------------------------------------------------------------------------
// Phase 3a — Refresh Events (read-only mirror of the public Events sheet)
// ---------------------------------------------------------------------------

/**
 * Fetch the public event-map's published Events CSV and (re)populate the
 * read-only Events_Reference tab with EventID + public display fields.
 *
 * READ-ONLY in both directions: this only fetches the already-public CSV; it
 * never writes back to the event-map sheet, and partner data never leaves this
 * workbook (privacy wall — AGENTS.md #1/#2). The tab is a disposable mirror —
 * every run clears its data rows and rewrites them, deduped by EventID. Rows
 * with no EventID are skipped (they can't be joined to).
 */
function refreshEvents() {
  // Runs from the menu AND from the daily time-trigger (Section 3). Do the work
  // first, then give UI feedback only if a UI is available — getUi() throws in
  // trigger context, so a failed refresh there surfaces in the execution log.
  let result = null, error = null;
  try {
    result = withLock_(function() {
      const rows = fetchEventsCsv_();
      const spec = CONFIG.EVENTS_REF;
      const sheet = getOrCreateSheet_(spec.name);
      setupEventsReferenceSheet_(sheet);

      const seen = {};
      const out = [];
      let skipped = 0;
      rows.forEach(function(r) {
        const id = String(r.EventID || '').trim();
        if (!id) { skipped++; return; }
        if (seen[id]) return;        // dedupe — keep the first row for an EventID
        seen[id] = true;
        out.push(spec.headers.map(function(h) {
          const v = r[h];
          return (v === undefined || v === null) ? '' : v;
        }));
      });

      // Replace all data rows (header row 1 stays put).
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, spec.headers.length).clearContent();
      }
      if (out.length) {
        sheet.getRange(2, 1, out.length, spec.headers.length).setValues(out);
      }
      return { count: out.length, skipped: skipped };
    });
  } catch (err) {
    error = err;
  }

  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (!ui) {                       // time-trigger context — no dialogs
    if (error) throw error;        // let the failed run show in the execution log
    return result;
  }

  if (error) {
    ui.alert('Refresh Events failed', String(error && error.message ? error.message : error), ui.ButtonSet.OK);
    return;
  }
  ui.alert(
    'Events refreshed',
    'Loaded ' + result.count + ' event' + (result.count === 1 ? '' : 's') +
    ' into the read-only "Events_Reference" tab' +
    (result.skipped ? ' (' + result.skipped + ' row(s) skipped — no EventID).' : '.') +
    '\n\nThis tab mirrors the public Events sheet. Don\'t hand-edit it — re-run ' +
    'Refresh Events to update. Now use "Link Partner to Event(s)" to connect partners.',
    ui.ButtonSet.OK
  );
  return result;
}

/**
 * Fetch + parse the published Events CSV into an array of row objects keyed by
 * the CSV's own header names. Throws a friendly error on a non-200 response or
 * an empty/headerless sheet.
 */
function fetchEventsCsv_() {
  const resp = UrlFetchApp.fetch(CONFIG.EVENTS_CSV_URL, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('The public Events CSV returned HTTP ' + code +
      '. Its published link may have been turned off or changed.');
  }
  let text = resp.getContentText();
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

  const table = Utilities.parseCsv(text);
  if (!table || table.length < 2) {
    throw new Error('The Events sheet came back empty. Nothing to mirror.');
  }
  const headers = table[0].map(function(h) { return String(h || '').trim(); });
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells || !cells.length) continue;
    const obj = {};
    headers.forEach(function(h, c) { if (h) obj[h] = cells[c]; });
    rows.push(obj);
  }
  return rows;
}

/**
 * Lay down the Events_Reference header row, brand styling, and a warning-only
 * protection so a human is nudged not to hand-edit the mirror. Idempotent and
 * data-safe: only the header row + formatting are (re)written here; refreshEvents
 * owns the data rows. Script writes pass straight through warning-only
 * protection, so refreshEvents is never blocked.
 */
function setupEventsReferenceSheet_(sheet) {
  const spec = CONFIG.EVENTS_REF;
  const n = spec.headers.length;

  sheet.getRange(1, 1, 1, n).setValues([spec.headers]);
  sheet.getRange(1, 1, 1, n)
    .setBackground(CONFIG.COLORS.HEADER_BG)
    .setFontColor(CONFIG.COLORS.HEADER_TEXT)
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, n, 160);
  sheet.getRange(1, 1).setNote(
    'READ-ONLY mirror of the public Events sheet. Managed by FTC ▸ Refresh Events. ' +
    'Do not hand-edit — changes are overwritten on the next refresh.'
  );

  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!existing.length) {
    sheet.protect()
      .setWarningOnly(true)
      .setDescription('Read-only mirror of the public Events sheet — managed by FTC ▸ Refresh Events.');
  }
}

// ---------------------------------------------------------------------------
// Phase 3a — Link Partner to Event(s) (the many-to-many join)
// ---------------------------------------------------------------------------

/** Open the Link Partner to Event(s) dialog. */
function openLinkPartnerDialog() {
  const html = HtmlService.createHtmlOutputFromFile('LinkPartnerDialog')
    .setWidth(560).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Link Partner to Event(s)');
}

/** Open the View Links dialog. */
function openViewLinksDialog() {
  const html = HtmlService.createHtmlOutputFromFile('ViewLinksDialog')
    .setWidth(560).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'View Event ↔ Partner Links');
}

/**
 * Data the link / view dialogs need to render their pickers: the partner list
 * (by name) and the event list (labelled "City — Venue", value = EventID). Both
 * are internal-only (this runs inside the gated sheet), but only public event
 * fields are sent for events. Returns hasEvents=false when Events_Reference is
 * empty so the dialog can prompt "Refresh Events first".
 */
function getLinkDialogData() {
  const partners = readAllPartners_().map(function(p) {
    return { id: p.PartnerID, name: p.organization_name, location: partnerLocation_(p) };
  });
  const events = readEventsReference_().map(function(e) {
    return { id: e.EventID, label: eventLabel_(e), status: String(e.Status || '').trim(),
             paused: String(e.Paused || '').trim().toLowerCase() === 'yes' };
  });
  return { partners: partners, events: events, hasEvents: events.length > 0 };
}

/**
 * Upsert links between one partner and one or more events. For each EventID:
 * if a (PartnerID, EventID) row already exists, UPDATE it (active +
 * recurring_slot) and keep its LinkID; otherwise append a new row with a fresh
 * LinkID. Many-to-many: a partner may link to many events here, and an event
 * accumulates many partners across calls. Returns a per-event breakdown.
 *
 * payload = { partnerId, eventIds:[...], recurring_slot, active }
 */
function linkPartnerToEvents(payload) {
  return withLock_(function() {
    const data = payload || {};
    const partnerId = String(data.partnerId || '').trim();
    const eventIds = (data.eventIds || []).map(function(x) { return String(x || '').trim(); })
      .filter(function(x) { return x; });
    const recurringSlot = String(data.recurring_slot || '').trim();
    const active = (data.active === true ||
      ['true', 'yes', 'on', '1'].indexOf(String(data.active).trim().toLowerCase()) !== -1);
    // Mark this partner as the event's PRIMARY (default) partner (Section 1).
    // When set, every other partner linked to the same event is demoted so only
    // one primary exists per EventID.
    const isPrimary = (data.is_primary === true ||
      ['true', 'yes', 'on', '1'].indexOf(String(data.is_primary).trim().toLowerCase()) !== -1);

    if (!partnerId) throw new Error('Pick a partner first.');
    if (!eventIds.length) throw new Error('Select at least one event to link.');

    // Validate the partner + events against the current data so we never link to
    // an unknown/stale id.
    const partner = readAllPartners_().filter(function(p) { return p.PartnerID === partnerId; })[0];
    if (!partner) throw new Error('That partner no longer exists. Reopen the dialog and pick again.');

    const eventsById = {};
    readEventsReference_().forEach(function(e) { eventsById[e.EventID] = e; });

    const spec = CONFIG.SHEETS.LINKS;
    const sheet = getOrCreateSheet_(spec.name);
    ensureLinkHeaders_(sheet);
    const map = headerMap_(sheet);
    const links = readAllLinks_(sheet, map);

    // Index existing links by PartnerID|EventID for the upsert.
    const index = {};
    links.forEach(function(l) { index[l.PartnerID + '|' + l.EventID] = l; });

    let created = 0, updated = 0, skipped = 0;
    const details = [];
    let nextRow = sheet.getLastRow() + 1;

    eventIds.forEach(function(eventId) {
      if (!eventsById[eventId]) {
        skipped++;
        details.push({ eventId: eventId, label: eventId, action: 'skipped (unknown event — Refresh Events)' });
        return;
      }
      const label = eventLabel_(eventsById[eventId]);
      const existing = index[partnerId + '|' + eventId];
      if (existing) {
        const row = {
          LinkID: existing.LinkID || Utilities.getUuid(),
          EventID: eventId,
          PartnerID: partnerId,
          active: active,
          recurring_slot: recurringSlot,
          last_capacity_confirmed: existing.last_capacity_confirmed || '',
          is_primary: isPrimary
        };
        writeLinkRow_(sheet, existing._row, row, map);
        updated++;
        details.push({ eventId: eventId, label: label, action: isPrimary ? 'updated (primary)' : 'updated' });
      } else {
        const row = {
          LinkID: Utilities.getUuid(),
          EventID: eventId,
          PartnerID: partnerId,
          active: active,
          recurring_slot: recurringSlot,
          last_capacity_confirmed: '',
          is_primary: isPrimary
        };
        writeLinkRow_(sheet, nextRow, row, map);
        index[partnerId + '|' + eventId] = { _row: nextRow }; // guard dup ids in same call
        nextRow++;
        created++;
        details.push({ eventId: eventId, label: label, action: isPrimary ? 'created (primary)' : 'created' });
      }
    });

    // Enforce one primary per event: when this partner was set primary for an
    // event, demote every OTHER partner's link on that same event. `links` was
    // read before our writes, but it only reflects OTHER partners here (we never
    // touch another partner's row above), so it's the right set to demote.
    let demoted = 0;
    if (isPrimary) {
      const targetEvents = {};
      eventIds.forEach(function(eid) { if (eventsById[eid]) targetEvents[eid] = true; });
      links.forEach(function(l) {
        if (!targetEvents[l.EventID]) return;
        if (l.PartnerID === partnerId) return;        // keep our own (just-set) primary
        if (!isTruthyFlag_(l.is_primary)) return;      // already a backup
        writeLinkRow_(sheet, l._row, {
          LinkID: l.LinkID,
          EventID: l.EventID,
          PartnerID: l.PartnerID,
          active: isTruthyFlag_(l.active),
          recurring_slot: String(l.recurring_slot || ''),
          last_capacity_confirmed: l.last_capacity_confirmed || '',
          is_primary: false
        }, map);
        demoted++;
      });
    }

    return {
      partnerName: partner.organization_name,
      created: created,
      updated: updated,
      skipped: skipped,
      active: active,
      isPrimary: isPrimary,
      demoted: demoted,
      details: details
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 3a — View Links (both directions of the join)
// ---------------------------------------------------------------------------

/**
 * List the events a partner is linked to. Joins EventPartnerLinks → the
 * Events_Reference mirror for a friendly label/status. A link whose event isn't
 * in the current mirror is still listed (flagged stale) so nothing silently
 * disappears.
 */
function getLinksForPartner(partnerId) {
  const id = String(partnerId || '').trim();
  if (!id) return { partnerId: '', items: [] };

  const partner = readAllPartners_().filter(function(p) { return p.PartnerID === id; })[0];
  const eventsById = {};
  readEventsReference_().forEach(function(e) { eventsById[e.EventID] = e; });

  const items = readAllLinks_().filter(function(l) { return l.PartnerID === id; })
    .map(function(l) {
      const ev = eventsById[l.EventID];
      return {
        linkId: l.LinkID,
        eventId: l.EventID,
        label: ev ? eventLabel_(ev) : ('Unknown event (' + l.EventID + ')'),
        status: ev ? String(ev.Status || '').trim() : '',
        stale: !ev,
        active: isTruthyFlag_(l.active),
        is_primary: isTruthyFlag_(l.is_primary),
        recurring_slot: String(l.recurring_slot || '').trim(),
        last_capacity_confirmed: String(l.last_capacity_confirmed || '').trim()
      };
    });
  items.sort(linkLabelSort_);
  return { partnerId: id, partnerName: partner ? partner.organization_name : '', items: items };
}

/**
 * List the partners linked to an event. Joins EventPartnerLinks → Partners for
 * the org name. Internal-only view (runs inside the gated sheet).
 */
function getLinksForEvent(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return { eventId: '', items: [] };

  const partnersById = {};
  readAllPartners_().forEach(function(p) { partnersById[p.PartnerID] = p; });
  const ev = readEventsReference_().filter(function(e) { return e.EventID === id; })[0];

  const items = readAllLinks_().filter(function(l) { return l.EventID === id; })
    .map(function(l) {
      const p = partnersById[l.PartnerID];
      return {
        linkId: l.LinkID,
        partnerId: l.PartnerID,
        label: p ? p.organization_name : ('Unknown partner (' + l.PartnerID + ')'),
        location: p ? partnerLocation_(p) : '',
        stale: !p,
        active: isTruthyFlag_(l.active),
        is_primary: isTruthyFlag_(l.is_primary),
        recurring_slot: String(l.recurring_slot || '').trim(),
        last_capacity_confirmed: String(l.last_capacity_confirmed || '').trim()
      };
    });
  items.sort(linkLabelSort_);
  return { eventId: id, eventLabel: ev ? eventLabel_(ev) : '', items: items };
}

// ---------------------------------------------------------------------------
// Phase 3b — Rebuild public view (the published, no-contact subset)
// ---------------------------------------------------------------------------

/**
 * Regenerate the two PUBLIC tabs the Cloudflare map reads:
 *
 *   Partners_Public — one row per partner, NON-CONTACT subset only
 *     (PartnerID, organization_name, city, address, latitude, longitude,
 *      pathway, cold_storage, monthly_capacity_meals, recurring_slot,
 *      partnership_status). Contact name/phone/email, agreement_on_file,
 *      agreement_date and last_verified are NEVER copied here.
 *   Links_Public — one row per event↔partner link: PartnerID, EventID, active
 *     (active normalized to a real TRUE/FALSE). last_capacity_confirmed and the
 *     per-link recurring_slot stay internal.
 *
 * This is the Phase-3b scoped override of the privacy wall (decided 2026-06-19):
 * the non-contact subset is intentionally public; everything sensitive stays in
 * the private tabs. Both tabs are fully rebuilt each run (header + data rewritten,
 * deduped), brand-styled navy (to read as "this one is published"), and carry a
 * warning-only protection + header note so they aren't hand-edited.
 *
 * After running, publish each tab to web as CSV (File ▸ Share ▸ Publish to web ▸
 * pick the tab ▸ CSV). Those CSV URLs go into src/index.html's CONFIG.
 */
function rebuildPublicView() {
  const ui = SpreadsheetApp.getUi();
  let result;
  try {
    result = withLock_(function() {
      // Partners → public subset. Keep only rows that are real partners (id +
      // name), mapped down to the public columns. Coordinates may be blank; the
      // map simply won't plot those (same as a missing geocode).
      const pSpec = CONFIG.PUBLIC.PARTNERS;
      const partners = readAllPartners_();
      const pRows = partners.map(function(p) {
        return pSpec.headers.map(function(h) {
          const v = p[h];
          return (v === undefined || v === null) ? '' : v;
        });
      });

      // Links → PartnerID/EventID/active. Only emit links whose partner is in the
      // public set AND whose event still exists in the mirror, so the published
      // graph never points at a partner we didn't publish or a stale event.
      const lSpec = CONFIG.PUBLIC.LINKS;
      const publicPartnerIds = {};
      partners.forEach(function(p) { publicPartnerIds[p.PartnerID] = true; });
      const knownEventIds = {};
      readEventsReference_().forEach(function(e) { knownEventIds[e.EventID] = true; });

      let droppedLinks = 0;
      const lRows = [];
      readAllLinks_().forEach(function(l) {
        const pid = String(l.PartnerID || '').trim();
        const eid = String(l.EventID || '').trim();
        if (!pid || !eid) return;
        if (!publicPartnerIds[pid] || !knownEventIds[eid]) { droppedLinks++; return; }
        lRows.push([pid, eid, isTruthyFlag_(l.active)]);
      });

      writePublicSheet_(pSpec, pRows);
      writePublicSheet_(lSpec, lRows);

      return { partners: pRows.length, links: lRows.length, droppedLinks: droppedLinks };
    });
  } catch (err) {
    ui.alert('Rebuild public view failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
    return;
  }

  ui.alert(
    'Public view rebuilt',
    'Partners_Public: ' + result.partners + ' partner(s) (non-contact subset).\n' +
    'Links_Public: ' + result.links + ' link(s)' +
    (result.droppedLinks ? ' (' + result.droppedLinks + ' link(s) skipped — partner or event not in the public set).' : '.') +
    '\n\nNeither tab contains contact info, agreement status, or last_verified.\n\n' +
    'Next: File ▸ Share ▸ Publish to web, and publish BOTH "Partners_Public" and ' +
    '"Links_Public" as CSV (also publish "Events_Reference" if you haven\'t). ' +
    'Paste those CSV URLs into src/index.html.',
    ui.ButtonSet.OK
  );
}

/**
 * Replace a public tab's contents: lay down the header (navy, distinct from the
 * orange internal tabs), rewrite all data rows, and (re)apply a warning-only
 * protection + note. Idempotent and self-contained.
 */
function writePublicSheet_(spec, rows) {
  const sheet = getOrCreateSheet_(spec.name);
  const n = spec.headers.length;

  // Header row + styling (navy = "published" so it's visually distinct).
  sheet.getRange(1, 1, 1, n).setValues([spec.headers]);
  sheet.getRange(1, 1, 1, n)
    .setBackground(CONFIG.COLORS.NAVY)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, n, 150);
  sheet.getRange(1, 1).setNote(
    'AUTO-GENERATED PUBLIC VIEW. Managed by FTC ▸ Rebuild public view; published ' +
    'to web as CSV for the public map. Do NOT hand-edit — overwritten on rebuild. ' +
    'Contains NO contact info, agreement status, or last_verified.'
  );

  // Clear old data rows, then write the new ones.
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), n)).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, n).setValues(rows);

  if (!sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    sheet.protect()
      .setWarningOnly(true)
      .setDescription('Auto-generated public view — managed by FTC ▸ Rebuild public view.');
  }
}

// ===========================================================================
// Phase 4 → Section 2 — Pre-event capacity check via LEADER REMINDERS
// ===========================================================================
//
// The system NO LONGER emails partners directly. About a week before each event,
// it reminds the EVENT'S LEADER (resolved from the Leaders tab, Section 1) about
// that event's PRIMARY partner, and gives the leader a ready-to-send template
// with the partner's prefilled Google-Form link embedded. The leader forwards it
// however they reach the partner (email/text/call); the partner's response still
// logs to CapacityChecks via the form. The app records numbers; it never sets an
// expected total or judges sufficiency — the LEADER reads the confirmed numbers
// and decides. Backups are a separate, always-available action ("Find Nearby
// Pantries"), never gated on a computed shortfall. Contact fields stay INTERNAL
// (shown to the leader, never published — privacy wall).
//
// Flow:
//   1. sendLeaderReminders() — runs two ways: the "Send Reminders Now" menu item
//      AND a daily time-trigger (ensureReminderTrigger_). For every non-paused
//      event whose next occurrence is within REMINDER_LEAD_DAYS, it resolves the
//      leader + primary partner, upserts ONE CapacityChecks row (Status='sent')
//      for that primary partner + date, and emails the leader a reminder + forward
//      template containing the prefilled form link. A per-(event,occurrence)
//      dedupe stops a leader being reminded twice for the same date.
//   2. "Send Reminder for One Event…" — runCapacityCheck() does the same for a
//      single chosen event, on demand (forces a send even if already reminded).
//   3. Responses come back via that ONE reusable Google Form (NOT reply-scanning).
//      onCapacityFormSubmit() (an installable trigger) reads the CheckID + Yes/No
//      + meals and writes Status / ConfirmedMeals / ResponseTimestamp back onto
//      the matching CapacityChecks row (and stamps the link's
//      last_capacity_confirmed).
//   4. "View Capacity Status" — per event+date: each partner's response and the
//      confirmed-meals total. No shortfall judgment.
//   5. "Find Nearby Pantries" (any time) — ranks the full candidate+active partner
//      universe by distance from a chosen event, excluding partners already linked
//      to it, with each one's pathway, capacity, and contact so the leader can
//      line up backups. See nearestPartnersForEvent_ / findNearbyPantries.

/** Open the Run Capacity Check dialog. */
function openRunCapacityCheckDialog() {
  const html = HtmlService.createHtmlOutputFromFile('RunCapacityCheckDialog')
    .setWidth(580).setHeight(780);
  SpreadsheetApp.getUi().showModalDialog(html, 'Run Pre-Event Capacity Check');
}

/** Open the View Capacity Status dialog. */
function openViewCapacityStatusDialog() {
  const html = HtmlService.createHtmlOutputFromFile('ViewCapacityStatusDialog')
    .setWidth(600).setHeight(740);
  SpreadsheetApp.getUi().showModalDialog(html, 'Capacity Check Status');
}

/**
 * Data the Run Capacity Check dialog needs to render its event picker. Events
 * come from the read-only Events_Reference mirror (run Refresh Events first).
 */
function getRunCapacityCheckData() {
  const events = readEventsReference_().map(function(e) {
    return { id: e.EventID, label: eventLabel_(e),
             status: String(e.Status || '').trim(),
             paused: String(e.Paused || '').trim().toLowerCase() === 'yes' };
  });
  return { events: events, hasEvents: events.length > 0 };
}

/**
 * Preview for the "Send Reminder for One Event" dialog (Section 2): the event's
 * resolved leader (who gets the reminder) and its primary partner (who the leader
 * forwards to), plus the computed next-occurrence date. The leader/primary may be
 * flagged (no email, no primary set) so the dialog can warn before sending.
 * Internal-only — the primary partner's contact fields are shown to the operator
 * but never published.
 */
function getLeaderReminderPreview(eventId) {
  const r = resolveEventLeaderAndPrimary(eventId);
  if (!r.found) return { found: false };
  const occ = nextEventOccurrence_(r.saturday, todayLocal_());
  return {
    found: true,
    eventLabel: r.eventLabel,
    saturday: r.saturday,
    nextDate: occ ? ymdLocal_(occ) : '',
    leader: r.leader,
    primary: r.primary
  };
}

/**
 * Send leader reminders for every event whose next occurrence is within
 * REMINDER_LEAD_DAYS. Runs two ways (Section 2): the "Send Reminders Now" menu
 * item AND the daily time-trigger (ensureReminderTrigger_) — both call this same
 * function. In menu (UI) context it shows a summary alert; in trigger context
 * SpreadsheetApp.getUi() throws and the alert is silently skipped. Deduped so a
 * leader isn't reminded twice for the same (event, occurrence).
 */
function sendLeaderReminders() {
  const summary = runLeaderReminders_({ force: false });
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Leader reminders', formatReminderSummary_(summary), ui.ButtonSet.OK);
  } catch (e) { /* time-trigger context — no UI available */ }
  return summary;
}

/** Human-readable summary of a reminder run, for the menu alert. */
function formatReminderSummary_(s) {
  let msg = s.sent.length + ' reminder' + (s.sent.length === 1 ? '' : 's') +
    ' sent to leaders for events within ' + s.windowDays + ' days.';
  if (s.sent.length) {
    msg += '\n\nSent:\n' + s.sent.map(function(r) {
      return '• ' + r.eventLabel + ' · ' + r.eventDate + ' → ' + r.leaderName +
        ' (' + r.sentTo + '), re: ' + r.primaryName;
    }).join('\n');
  }
  if (s.alreadyDone.length) {
    msg += '\n\nAlready reminded this cycle: ' + s.alreadyDone.length + '.';
  }
  if (s.needsAttention.length) {
    msg += '\n\nNeeds attention (NOT sent — will retry once fixed):\n' +
      s.needsAttention.map(function(r) {
        return '• ' + r.eventLabel + (r.eventDate ? (' · ' + r.eventDate) : '') + ' — ' + r.reason;
      }).join('\n');
  }
  if (!s.sent.length && !s.needsAttention.length && !s.alreadyDone.length) {
    msg += '\n\nNo events are within the reminder window right now.';
  }
  return msg;
}

/**
 * The reminder engine. For each non-paused event whose next occurrence is in the
 * [0, REMINDER_LEAD_DAYS] window and hasn't been reminded yet (dedupe), resolve
 * the leader + primary partner, upsert the primary's CapacityChecks row, and
 * email the leader. Events that can't be reminded (no recognized Saturday, no
 * primary partner, no leader email) go to `needsAttention` and are NOT deduped,
 * so they retry on the next run once fixed. `opts.force` bypasses the dedupe.
 */
function runLeaderReminders_(opts) {
  opts = opts || {};
  const today = todayLocal_();
  const leadDays = REMINDER_LEAD_DAYS;
  const events = readEventsReference_();
  const ctx = {
    form: ensureCapacityForm_(),
    leaders: readAllLeaders_(),
    partnersById: (function() { const m = {}; readAllPartners_().forEach(function(p) { m[p.PartnerID] = p; }); return m; })(),
    links: readAllLinks_()
  };
  const sentMap = getRemindersSent_();
  pruneRemindersSent_(sentMap, today);

  const sent = [], needsAttention = [], alreadyDone = [];
  events.forEach(function(ev) {
    if (String(ev.Paused || '').trim().toLowerCase() === 'yes') return;
    const occ = nextEventOccurrence_(ev.Saturday, today);
    if (!occ) {
      needsAttention.push({ eventLabel: eventLabel_(ev), eventDate: '',
        reason: 'Unrecognized "Saturday" value ("' + String(ev.Saturday || '') + '") — can\'t compute the next date.' });
      return;
    }
    const daysUntil = dayDiff_(today, occ);
    if (daysUntil < 0 || daysUntil > leadDays) return; // outside the reminder window
    const occYmd = ymdLocal_(occ);
    const key = ev.EventID + '|' + occYmd;
    if (!opts.force && sentMap[key]) { alreadyDone.push({ eventLabel: eventLabel_(ev), eventDate: occYmd }); return; }

    const res = remindLeaderForEvent_(ev, occYmd, ctx);
    if (res.ok) {
      sent.push(res);
      sentMap[key] = occYmd;              // dedupe marker (value = date, for pruning)
    } else {
      needsAttention.push({ eventLabel: res.eventLabel, eventDate: occYmd, reason: res.reason });
    }
  });

  saveRemindersSent_(sentMap);
  return { sent: sent, needsAttention: needsAttention, alreadyDone: alreadyDone, windowDays: leadDays };
}

/**
 * Remind one event's leader about its primary partner for a given occurrence date.
 * Resolves leader + primary (Section 1), upserts the primary partner's
 * CapacityChecks row (Status='sent'; preserves an existing response), builds the
 * prefilled form link keyed to that CheckID, and emails the leader. Returns
 * { ok, reason, ... }. ok=false (with a reason) when there's no primary partner
 * or no leader email — the caller surfaces it and does not dedupe it.
 */
function remindLeaderForEvent_(ev, occYmd, ctx) {
  const leader = resolveEventLeader_(ev, ctx.leaders);
  const primary = resolveEventPrimaryPartner_(ev.EventID, ctx.partnersById, ctx.links);
  const out = {
    eventId: ev.EventID, eventLabel: eventLabel_(ev), eventDate: occYmd,
    leaderName: leader.name, leaderEmail: leader.email, leaderFlag: leader.flag,
    primaryName: primary ? primary.name : '', ok: false, reason: '', sentTo: ''
  };
  if (!primary) {
    out.reason = 'No primary partner is linked to this event. Mark one in FTC ▸ Link Partner to Event(s).';
    return out;
  }
  if (!leader.email) {
    out.reason = leader.flag || 'No leader email on file — add the leader on the Leaders tab.';
    return out;
  }
  const checkId = upsertCapacityCheck_(ev.EventID, primary.partnerId, occYmd);
  const url = capacityPrefilledUrl_(ctx.form, checkId);
  sendLeaderReminderEmail_(leader, ev, occYmd, primary, url);
  out.ok = true;
  out.checkId = checkId;
  out.sentTo = leader.email;
  return out;
}

/**
 * Upsert ONE CapacityChecks row keyed by (EventID, PartnerID, EventDate), under
 * the document lock. Keeps the CheckID on a re-run so a resend never duplicates a
 * row, and PRESERVES an existing response (ConfirmedMeals / Status /
 * ResponseTimestamp) so re-sending a reminder never wipes a partner's answer —
 * only SentTimestamp is refreshed. Returns the CheckID. RequestedMeals stays
 * blank (no expected total — Section 0).
 */
function upsertCapacityCheck_(eventId, partnerId, eventDate) {
  return withLock_(function() {
    const spec = CONFIG.SHEETS.CAPACITY;
    const sheet = getOrCreateSheet_(spec.name);
    ensureCapacityHeaders_(sheet);
    const map = headerMap_(sheet);

    const prior = readAllCapacityChecks_(sheet, map).filter(function(r) {
      return String(r.EventID || '').trim() === eventId &&
             String(r.PartnerID || '').trim() === partnerId &&
             ymd_(r.EventDate) === eventDate;
    })[0];

    const responded = prior && String(prior.ResponseTimestamp || '').trim();
    const checkId = (prior && String(prior.CheckID || '').trim()) || Utilities.getUuid();
    const obj = {
      CheckID: checkId,
      EventID: eventId,
      PartnerID: partnerId,
      EventDate: eventDate,
      RequestedMeals: '',                                  // no expected total (Section 0)
      ConfirmedMeals: responded ? prior.ConfirmedMeals : '',
      Status: responded ? prior.Status : 'sent',
      SentTimestamp: new Date(),                           // always refresh "last nudged"
      ResponseTimestamp: responded ? prior.ResponseTimestamp : ''
    };
    writeCapacityRow_(sheet, prior ? prior._row : sheet.getLastRow() + 1, obj, map);
    return checkId;
  });
}

/**
 * Email the EVENT'S LEADER (Section 2): which event + date, their primary
 * partner's name + contact, and a ready-to-send template the leader can paste/
 * forward to that partner — with the partner's PREFILLED form link embedded so
 * the partner's response still logs to CapacityChecks. Uses the INTERNAL contact
 * fields (shown to the leader only; never published). MailApp, plain + branded
 * HTML.
 */
function sendLeaderReminderEmail_(leader, ev, dateYmd, primary, url) {
  const label = eventLabel_(ev);
  const time = String(ev.Time || '').trim();
  const leaderFirst = (String(leader.name || '').split(/\s+/)[0]) || 'there';
  const org = primary.name || 'your distribution partner';
  const partnerContactName = primary.contactName || 'there';
  const subject = 'Feed the City reminder — confirm ' + label + ' (' + dateYmd + ')';

  const contactBits = [];
  if (primary.contactName) contactBits.push(primary.contactName);
  if (primary.contactPhone) contactBits.push(primary.contactPhone);
  if (primary.contactEmail) contactBits.push(primary.contactEmail);
  const contactLine = contactBits.length ? contactBits.join(' · ') : 'No contact on file — add one via FTC ▸ Edit Partner.';

  // The template the leader forwards to the partner (carries the prefilled link).
  const template =
    'Hi ' + partnerContactName + ',\n\n' +
    'This is ' + (leader.name || 'your Feed the City chapter leader') + ' with Feed the City. ' +
    'We have an upcoming food distribution on ' + dateYmd + (time ? (' (' + time + ')') : '') +
    ' — ' + label + '. Can ' + org + ' take food this cycle, and roughly how many meals?\n\n' +
    'Please let us know here (about 10 seconds): ' + url + '\n\n' +
    'Thank you so much!\n' + (leader.name || 'Feed the City');

  const plain = 'Hi ' + leaderFirst + ',\n\n' +
    'Reminder: ' + label + ' is coming up on ' + dateYmd + (time ? (' (' + time + ')') : '') + '.\n\n' +
    'Your primary distribution partner is ' + org + '.\n' +
    'Contact: ' + contactLine + '\n\n' +
    'Please reach out to confirm they can take this cycle\'s food. You can copy the ' +
    'message below straight to them — it has their personal confirmation link, which ' +
    'logs their answer back to the team automatically:\n\n' +
    '----- copy below this line -----\n' + template + '\n----- end -----\n\n' +
    'Need backups? Use FTC ▸ Find Nearby Pantries in the Partners sheet.\n\n' +
    'Thank you,\nFeed the City';

  const html =
    '<div style="font-family:Roboto,Arial,sans-serif;color:#1A1A1A;max-width:560px;line-height:1.5">' +
      '<p style="margin:0 0 12px">Hi ' + escHtml_(leaderFirst) + ',</p>' +
      '<p style="margin:0 0 12px">Reminder: <b>' + escHtml_(label) + '</b> is coming up on <b>' +
        escHtml_(dateYmd) + '</b>' + (time ? ' (' + escHtml_(time) + ')' : '') + '.</p>' +
      '<div style="background:#FFF1E6;border:1px solid #FBCF9C;border-radius:8px;padding:12px 14px;margin:0 0 14px">' +
        '<div style="font-size:12px;font-weight:700;color:#8a3b00;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Primary partner</div>' +
        '<div style="font-size:15px;font-weight:700;color:#003366">' + escHtml_(org) + '</div>' +
        '<div style="font-size:12.5px;color:#3c4043;margin-top:3px">' + escHtml_(contactLine) + '</div>' +
      '</div>' +
      '<p style="margin:0 0 8px">Please reach out to confirm they can take this cycle\'s food. ' +
        '<b>Copy the message below</b> straight to them — it has their personal confirmation link, ' +
        'which logs their answer back to the team automatically:</p>' +
      '<pre style="white-space:pre-wrap;background:#f6f8fa;border:1px solid #E5E7EB;border-radius:8px;' +
        'padding:12px 14px;font-family:Roboto,Arial,sans-serif;font-size:12.5px;color:#1A1A1A;margin:0 0 14px">' +
        escHtml_(template) + '</pre>' +
      '<p style="margin:0 0 4px"><a href="' + escHtml_(url) + '" style="background:#FF6500;color:#fff;' +
        'text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;display:inline-block">' +
        'Open the partner form →</a></p>' +
      '<p style="margin:14px 0 0;font-size:12px;color:#6B7280">Need backups? Use ' +
        '<b>FTC ▸ Find Nearby Pantries</b> in the Partners sheet.</p>' +
      '<p style="margin:14px 0 0">Thank you,<br><b style="color:#003366">Feed the City</b></p>' +
    '</div>';

  MailApp.sendEmail({ to: leader.email, subject: subject, body: plain, htmlBody: html, name: 'Feed the City' });
}

/**
 * "Send Reminder for One Event…" (Section 2) — send the leader reminder for a
 * single chosen event on demand. Same engine as the batch, but FORCES a send even
 * if the event was already reminded this cycle (and records the dedupe marker so
 * the daily batch won't re-send). Defaults the date to the computed next
 * occurrence when none is supplied.
 *
 * payload = { eventId, eventDate?:'YYYY-MM-DD' }
 */
function runCapacityCheck(payload) {
  const data = payload || {};
  const eventId = String(data.eventId || '').trim();
  let eventDate = String(data.eventDate || '').trim();
  if (!eventId) throw new Error('Pick an event first.');

  const ev = readEventsReference_().filter(function(e) { return e.EventID === eventId; })[0];
  if (!ev) throw new Error('That event is not in the current Events_Reference. Run Refresh Events and try again.');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const occ = nextEventOccurrence_(ev.Saturday, todayLocal_());
    eventDate = occ ? ymdLocal_(occ) : '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error('Pick the event date (couldn\'t compute it from the Saturday-of-month).');
  }

  const ctx = {
    form: ensureCapacityForm_(),
    leaders: readAllLeaders_(),
    partnersById: (function() { const m = {}; readAllPartners_().forEach(function(p) { m[p.PartnerID] = p; }); return m; })(),
    links: readAllLinks_()
  };
  const res = remindLeaderForEvent_(ev, eventDate, ctx);

  if (res.ok) {
    const map = getRemindersSent_();
    map[eventId + '|' + eventDate] = eventDate;   // keep the daily batch from re-sending
    saveRemindersSent_(map);
  }

  return {
    eventLabel: eventLabel_(ev),
    eventDate: eventDate,
    ok: res.ok,
    reason: res.reason,
    leaderName: res.leaderName,
    leaderEmail: res.sentTo,
    leaderFlag: res.leaderFlag,
    primaryName: res.primaryName
  };
}

/**
 * Install the daily leader-reminder time-trigger if it isn't already there
 * (Section 2). Idempotent — safe to call from Set up sheets repeatedly. Returns
 * true if it created a new trigger.
 */
function ensureReminderTrigger_() {
  const have = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === REMINDER_TRIGGER_FN && t.getEventType() === ScriptApp.EventType.CLOCK;
  });
  if (!have) {
    ScriptApp.newTrigger(REMINDER_TRIGGER_FN).timeBased().everyDays(1).atHour(REMINDER_TRIGGER_HOUR).create();
  }
  return !have;
}

/**
 * Install the daily Refresh Events time-trigger if it isn't already there
 * (Section 3) so Events_Reference stays current without anyone clicking. The
 * manual FTC ▸ Refresh Events menu item still works too. Idempotent. Returns true
 * if it created a new trigger.
 */
function ensureRefreshTrigger_() {
  const have = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === REFRESH_TRIGGER_FN && t.getEventType() === ScriptApp.EventType.CLOCK;
  });
  if (!have) {
    ScriptApp.newTrigger(REFRESH_TRIGGER_FN).timeBased().everyDays(1).atHour(REFRESH_TRIGGER_HOUR).create();
  }
  return !have;
}

/**
 * Summary of every capacity check, grouped by (event, date), for the View
 * Capacity Status picker. Confirmed total per group = sum(ConfirmedMeals) over
 * confirmed rows. No expected total / shortfall — the app reports, the leader
 * judges (Phase 5). Newest date first.
 */
function getCapacityStatusData() {
  const eventsById = {};
  readEventsReference_().forEach(function(e) { eventsById[e.EventID] = e; });

  const groups = {};
  readAllCapacityChecks_().forEach(function(r) {
    const eid = String(r.EventID || '').trim();
    if (!eid) return;
    const d = ymd_(r.EventDate);
    const key = eid + '||' + d;
    if (!groups[key]) {
      const ev = eventsById[eid];
      groups[key] = {
        eventId: eid, eventDate: d,
        label: (ev ? eventLabel_(ev) : ('Event ' + eid)) + (d ? (' · ' + d) : ''),
        total: 0, confirmed: 0, declined: 0, pending: 0, confirmedMeals: 0
      };
    }
    const g = groups[key];
    const st = String(r.Status || '').trim().toLowerCase();
    g.total++;
    if (st === 'confirmed') { g.confirmed++; g.confirmedMeals += Number(r.ConfirmedMeals) || 0; }
    else if (st === 'declined') { g.declined++; }
    else { g.pending++; }
  });

  const list = Object.keys(groups).map(function(k) { return groups[k]; });
  list.sort(function(a, b) {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? 1 : -1; // newest first
    return String(a.label).toLowerCase() < String(b.label).toLowerCase() ? -1 : 1;
  });
  return { groups: list };
}

/**
 * Full status for one event+date: each partner's response and the confirmed-meals
 * total. No expected total and no shortfall judgment (Phase 5) — the leader reads
 * the numbers and decides; "Find Nearby Pantries" is the separate, always-on way
 * to line up more partners. Dates are formatted to strings here
 * (google.script.run can't serialize Date objects).
 */
function getCapacityStatus(eventId, eventDate) {
  const eid = String(eventId || '').trim();
  const d = ymd_(eventDate);
  if (!eid) return { items: [], confirmedMeals: 0, counts: { total: 0, confirmed: 0, declined: 0, pending: 0 } };

  const partnersById = {};
  readAllPartners_().forEach(function(p) { partnersById[p.PartnerID] = p; });
  const ev = readEventsReference_().filter(function(e) { return e.EventID === eid; })[0];

  const rows = readAllCapacityChecks_().filter(function(r) {
    return String(r.EventID || '').trim() === eid && ymd_(r.EventDate) === d;
  });

  let confirmedMeals = 0, confirmed = 0, declined = 0, pending = 0;
  const items = rows.map(function(r) {
    const p = partnersById[r.PartnerID];
    const st = String(r.Status || '').trim().toLowerCase() || 'sent';
    const conf = Number(r.ConfirmedMeals) || 0;
    if (st === 'confirmed') { confirmed++; confirmedMeals += conf; }
    else if (st === 'declined') { declined++; }
    else { pending++; }
    return {
      checkId: r.CheckID, partnerId: r.PartnerID,
      name: p ? p.organization_name : ('Unknown partner (' + r.PartnerID + ')'),
      location: p ? partnerLocation_(p) : '',
      confirmed: conf, status: st,
      sent: formatTs_(r.SentTimestamp), responded: formatTs_(r.ResponseTimestamp),
      stale: !p
    };
  });
  items.sort(function(a, b) {
    return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1;
  });

  return {
    eventId: eid, eventDate: d,
    eventLabel: ev ? eventLabel_(ev) : ('Event ' + eid),
    items: items,
    confirmedMeals: confirmedMeals,
    counts: { total: rows.length, confirmed: confirmed, declined: declined, pending: pending }
  };
}

// ---------------------------------------------------------------------------
// Phase 4 — the reusable response Google Form + submit trigger
// ---------------------------------------------------------------------------

/**
 * Get (or lazily create) the ONE reusable capacity-check Google Form, and make
 * sure its onFormSubmit trigger is installed. The form id + its three item ids +
 * the published URL are cached in DocumentProperties so every check reuses the
 * same form and the submit trigger can route responses by CheckID.
 *
 * The form has three items: a short-text "Reference code" (we prefill the
 * CheckID per partner — please-don't-edit), a Yes/No multiple choice, and a
 * short-text meals count. Responses are NOT sent to a destination sheet — the
 * onFormSubmit trigger writes straight back to CapacityChecks.
 */
function ensureCapacityForm_() {
  const props = PropertiesService.getDocumentProperties();
  let form = null;
  const formId = props.getProperty(CAPACITY_PROPS.FORM_ID);
  if (formId) {
    try { form = FormApp.openById(formId); } catch (err) { form = null; }
  }

  if (!form) {
    form = FormApp.create('Feed the City — Pre-Event Capacity Check');
    form.setDescription(
      'Confirm whether your organization can receive food for an upcoming Feed ' +
      'the City distribution. This form is keyed to a unique reference code from ' +
      'your email — please leave that field as-is.');
    form.setCollectEmail(false);
    form.setAllowResponseEdits(false);
    form.setConfirmationMessage(
      'Thank you — your response has been recorded. Feed the City will follow up if needed.');

    const checkItem = form.addTextItem()
      .setTitle(CAPACITY_FORM_TITLES.CHECKID)
      .setHelpText('Auto-filled from your email link. Please do not change this.')
      .setRequired(true);
    const yesNo = form.addMultipleChoiceItem()
      .setTitle(CAPACITY_FORM_TITLES.YESNO)
      .setChoiceValues(['Yes — we can take it', 'No — we cannot this time'])
      .setRequired(true);
    const meals = form.addTextItem()
      .setTitle(CAPACITY_FORM_TITLES.MEALS)
      .setHelpText('Approximate number of meals you can take (leave blank or 0 if not).')
      .setRequired(false);

    props.setProperty(CAPACITY_PROPS.FORM_ID, form.getId());
    props.setProperty(CAPACITY_PROPS.PUBLISHED_URL, form.getPublishedUrl());
    props.setProperty(CAPACITY_PROPS.ITEM_CHECKID, String(checkItem.getId()));
    props.setProperty(CAPACITY_PROPS.ITEM_YESNO, String(yesNo.getId()));
    props.setProperty(CAPACITY_PROPS.ITEM_MEALS, String(meals.getId()));
  }

  ensureCapacityFormTrigger_(form);
  return form;
}

/**
 * Ensure exactly one onFormSubmit trigger points at this form. Deletes any stale
 * capacity-submit trigger left pointing at a previous form (e.g. if the form was
 * re-created), then installs one if missing. Idempotent.
 */
function ensureCapacityFormTrigger_(form) {
  const formId = form.getId();
  let haveForThisForm = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() !== CAPACITY_TRIGGER_FN) return;
    if (t.getTriggerSourceId() === formId) haveForThisForm = true;
    else ScriptApp.deleteTrigger(t); // stale — pointed at an old form
  });
  if (!haveForThisForm) {
    ScriptApp.newTrigger(CAPACITY_TRIGGER_FN).forForm(form).onFormSubmit().create();
  }
}

/**
 * Build a form URL prefilled with this CheckID so the partner's response is
 * keyed to the right CapacityChecks row. Falls back to the plain published URL
 * if the prefill item can't be resolved.
 */
function capacityPrefilledUrl_(form, checkId) {
  const props = PropertiesService.getDocumentProperties();
  let textItem = null;
  const itemId = props.getProperty(CAPACITY_PROPS.ITEM_CHECKID);
  if (itemId) {
    try { textItem = form.getItemById(Number(itemId)).asTextItem(); } catch (err) { textItem = null; }
  }
  if (!textItem) {
    const items = form.getItems(FormApp.ItemType.TEXT);
    for (let i = 0; i < items.length; i++) {
      if (items[i].getTitle() === CAPACITY_FORM_TITLES.CHECKID) { textItem = items[i].asTextItem(); break; }
    }
  }
  if (!textItem) return form.getPublishedUrl();

  const fr = form.createResponse();
  fr.withItemResponse(textItem.createResponse(String(checkId)));
  return fr.toPrefilledUrl();
}

/**
 * Installable onFormSubmit trigger. Routes a capacity-check response back to its
 * CapacityChecks row by CheckID: sets Status (confirmed/declined), ConfirmedMeals
 * (the partner's number, or 0 if they said yes without one or declined), and
 * ResponseTimestamp. Also stamps the matching link's last_capacity_confirmed.
 * Unknown / missing CheckIDs are ignored. Runs as the user who installed the
 * trigger, so it has full access to the sheet + links.
 */
function onCapacityFormSubmit(e) {
  if (!e || !e.response) return;

  const props = PropertiesService.getDocumentProperties();
  const idCheck = props.getProperty(CAPACITY_PROPS.ITEM_CHECKID);
  const idYesNo = props.getProperty(CAPACITY_PROPS.ITEM_YESNO);
  const idMeals = props.getProperty(CAPACITY_PROPS.ITEM_MEALS);

  let checkId = '', yesNo = '', mealsRaw = '';
  e.response.getItemResponses().forEach(function(ir) {
    const item = ir.getItem();
    const id = String(item.getId());
    const title = item.getTitle();
    const val = ir.getResponse();
    if (id === idCheck || title === CAPACITY_FORM_TITLES.CHECKID) checkId = String(val || '').trim();
    else if (id === idYesNo || title === CAPACITY_FORM_TITLES.YESNO) yesNo = String(val || '').trim();
    else if (id === idMeals || title === CAPACITY_FORM_TITLES.MEALS) mealsRaw = String(val || '').trim();
  });
  if (!checkId) return; // can't route without the reference code

  const saidYes = /^yes/i.test(yesNo);
  // Read the partner's OWN stated number from their reply and log it as-is. This
  // is NOT a prediction or a target — just the partner's answer ('' / no digits
  // → null). Section 0: the app never computes an expected total or a shortfall.
  let meals = null;
  if (mealsRaw !== '' && mealsRaw !== null && mealsRaw !== undefined) {
    const m = String(mealsRaw).replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
    if (m) { const n = Math.round(Number(m[0])); meals = isFinite(n) ? Math.max(0, n) : null; }
  }

  withLock_(function() {
    const spec = CONFIG.SHEETS.CAPACITY;
    const sheet = getOrCreateSheet_(spec.name);
    ensureCapacityHeaders_(sheet);
    const map = headerMap_(sheet);
    const target = readAllCapacityChecks_(sheet, map).filter(function(r) {
      return String(r.CheckID || '').trim() === checkId;
    })[0];
    if (!target) return; // unknown code — ignore

    const confirmedMeals = saidYes ? (meals !== null ? meals : 0) : 0;
    writeCapacityRow_(sheet, target._row, {
      CheckID: target.CheckID,
      EventID: target.EventID,
      PartnerID: target.PartnerID,
      EventDate: target.EventDate,
      RequestedMeals: target.RequestedMeals,
      ConfirmedMeals: confirmedMeals,
      Status: saidYes ? 'confirmed' : 'declined',
      SentTimestamp: target.SentTimestamp,
      ResponseTimestamp: new Date()
    }, map);

    if (saidYes) touchLinkCapacityConfirmed_(target.EventID, target.PartnerID);
  });
}

/**
 * Stamp the EventPartnerLinks row for (eventId, partnerId) with today's date in
 * last_capacity_confirmed (DATA_MODEL Tab 2 / PRD §7.3). No-ops if the column or
 * link row is absent. Does NOT take the document lock — it's only ever called
 * from inside onCapacityFormSubmit's lock (LockService locks aren't reentrant).
 */
function touchLinkCapacityConfirmed_(eventId, partnerId) {
  const sheet = getOrCreateSheet_(CONFIG.SHEETS.LINKS.name);
  const map = headerMap_(sheet);
  if (!map.last_capacity_confirmed) return;
  const row = readAllLinks_(sheet, map).filter(function(l) {
    return l.EventID === eventId && l.PartnerID === partnerId;
  })[0];
  if (!row) return;
  const today = Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  sheet.getRange(row._row, map.last_capacity_confirmed).setValue(today);
}

// ---------------------------------------------------------------------------
// Section 2 — reminder date logic + dedupe (the fiddly Saturday-of-month math)
// ---------------------------------------------------------------------------

/** Today at local midnight (script timezone), for whole-day comparisons. */
function todayLocal_() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** A local Date → 'YYYY-MM-DD'. */
function ymdLocal_(d) {
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
}

/** Whole days from a → b (both local-midnight Dates). Rounded to absorb DST. */
function dayDiff_(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Parse an event's "Saturday" field into an ordinal: 1..5 for First..Fifth (also
 * "1st".."5th" / a bare digit) or the string 'last' for "Last". null if blank /
 * unrecognized.
 */
function parseSaturdayOrdinal_(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  const words = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  if (words[t] !== undefined) return words[t];
  if (t === 'last') return 'last';
  const m = t.match(/^([1-5])(st|nd|rd|th)?$/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * The date of the Nth Saturday (n = 1..5) of a month, or null if that month has
 * no Nth Saturday (e.g. no 5th Saturday). month0 is 0-based (Jan = 0).
 */
function nthSaturdayOfMonth_(year, month0, n) {
  const firstDow = new Date(year, month0, 1).getDay();   // 0 Sun .. 6 Sat
  const firstSat = 1 + ((6 - firstDow + 7) % 7);          // date (1..7) of the first Saturday
  const date = firstSat + (n - 1) * 7;
  const d = new Date(year, month0, date);
  return d.getMonth() === month0 ? d : null;             // overflowed the month → no Nth Saturday
}

/** The date of the LAST Saturday of a month. */
function lastSaturdayOfMonth_(year, month0) {
  const last = new Date(year, month0 + 1, 0);             // last day of the month
  const date = last.getDate() - ((last.getDay() - 6 + 7) % 7);
  return new Date(year, month0, date);
}

/**
 * The next occurrence (>= fromDate) of an event given its "Saturday of the month"
 * field. Walks this month and forward up to 14 months, so it correctly skips a
 * month that has no Nth Saturday (e.g. a 5th-Saturday event in a 4-Saturday
 * month) and rolls into next month when this month's Saturday already passed.
 * Returns a local-midnight Date, or null if the field is unrecognized.
 *
 * Assumptions (documented): the public Events sheet's `Saturday` is one of
 * First/Second/Third/Fourth/Fifth/Last; events recur monthly on that Saturday.
 */
function nextEventOccurrence_(saturdayField, fromDate) {
  const ord = parseSaturdayOrdinal_(saturdayField);
  if (ord === null) return null;
  const base = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  for (let i = 0; i < 14; i++) {
    const ym = base.getFullYear() * 12 + base.getMonth() + i;
    const y = Math.floor(ym / 12);
    const m = ym % 12;
    const occ = (ord === 'last') ? lastSaturdayOfMonth_(y, m) : nthSaturdayOfMonth_(y, m, ord);
    if (occ && occ.getTime() >= base.getTime()) return occ;
  }
  return null;
}

/** The reminder dedupe map {EventID|YYYY-MM-DD: 'YYYY-MM-DD'} from ScriptProperties. */
function getRemindersSent_() {
  const raw = PropertiesService.getScriptProperties().getProperty(REMINDER_PROPS.SENT);
  if (!raw) return {};
  try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}

/** Persist the reminder dedupe map. */
function saveRemindersSent_(map) {
  PropertiesService.getScriptProperties().setProperty(REMINDER_PROPS.SENT, JSON.stringify(map || {}));
}

/** Drop dedupe keys whose occurrence date is in the past (keeps the store small). */
function pruneRemindersSent_(map, today) {
  const cutoff = ymdLocal_(today);
  Object.keys(map).forEach(function(k) {
    const d = String(map[k] || '');
    if (d && d < cutoff) delete map[k];   // string compare works for YYYY-MM-DD
  });
}

// ---------------------------------------------------------------------------
// Phase 4 / Section 5 — capacity + recommender helpers
// ---------------------------------------------------------------------------

/**
 * Rank partners from the full universe (partnership_status candidate OR active;
 * paused excluded) by distance from an event, EXCLUDING any already linked to it.
 * The shared engine behind "Find Nearby Pantries" (PRD §7.3, reframed in Phase 5
 * as a leader-initiated action, no longer gated on a computed shortfall).
 *
 * Ranked by great-circle distance from the event when both have coordinates; if
 * the event has no coordinates, ranked by capacity instead (byCapacity=true so the
 * dialog can say so). Partners without coordinates sort last in distance mode.
 * Each item carries pathway, capacity, and INTERNAL contact (name/phone/email) so
 * the leader can reach out — this runs inside the gated sheet, never public.
 * Capped at `limit`.
 */
function nearestPartnersForEvent_(eventId, excludeIds, limit) {
  const ev = readEventsReference_().filter(function(e) { return e.EventID === eventId; })[0];
  const evLat = ev ? Number(ev.Latitude) : NaN;
  const evLng = ev ? Number(ev.Longitude) : NaN;
  const haveEvCoords = validLatLng_(evLat, evLng);
  const UNIVERSE = { candidate: true, active: true }; // candidates + actives; paused excluded

  const candidates = readAllPartners_().filter(function(p) {
    if (excludeIds[p.PartnerID]) return false;
    return UNIVERSE[String(p.partnership_status || '').trim().toLowerCase()] === true;
  }).map(function(p) {
    const lat = Number(p.latitude), lng = Number(p.longitude);
    const has = validLatLng_(lat, lng);
    const cName = String(p.contact_name || '').trim();
    const cPhone = String(p.contact_phone || '').trim();
    const cEmail = String(p.contact_email || '').trim();
    return {
      partnerId: p.PartnerID,
      name: p.organization_name,
      location: partnerLocation_(p),
      status: String(p.partnership_status || '').trim().toLowerCase(),
      capacity: Number(p.monthly_capacity_meals) || 0,
      pathway: String(p.pathway || '').trim(),
      cold_storage: String(p.cold_storage || '').trim(),
      contactName: cName, contactPhone: cPhone, contactEmail: cEmail,
      hasContact: !!(cName || cPhone || cEmail),
      distanceMiles: (haveEvCoords && has) ? haversineMiles_(evLat, evLng, lat, lng) : null
    };
  });

  const byCapacity = !haveEvCoords;
  candidates.sort(function(a, b) {
    if (byCapacity) return b.capacity - a.capacity;
    if (a.distanceMiles === null && b.distanceMiles === null) return b.capacity - a.capacity;
    if (a.distanceMiles === null) return 1;
    if (b.distanceMiles === null) return -1;
    return a.distanceMiles - b.distanceMiles;
  });

  const items = candidates.slice(0, limit).map(function(c) {
    if (c.distanceMiles !== null) c.distanceMiles = Math.round(c.distanceMiles * 10) / 10;
    return c;
  });
  return { byCapacity: byCapacity, hasEventCoords: haveEvCoords, items: items };
}

/** Great-circle distance in miles between two lat/long points (haversine). */
function haversineMiles_(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius, miles
  const toRad = function(d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalize a stored date (Date or text) to a 'YYYY-MM-DD' string for keys/labels. */
function ymd_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/** Format a stored timestamp (Date or text) to 'YYYY-MM-DD HH:mm' for the client. */
function formatTs_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

/** HTML-escape for email bodies (mirrors the dialogs' client-side esc()). */
function escHtml_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

/**
 * All CapacityChecks rows as objects keyed by header, each tagged with its
 * 1-based sheet row in `_row`. Mirrors readAllLinks_. Optionally pass a pre-read
 * sheet + header map to avoid a re-read inside the upsert / submit handler.
 */
function readAllCapacityChecks_(sheet, map) {
  const spec = CONFIG.SHEETS.CAPACITY;
  sheet = sheet || getOrCreateSheet_(spec.name);
  map = map || headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = [];
  values.forEach(function(vals, i) {
    const obj = { _row: i + 2 };
    spec.headers.forEach(function(h) { obj[h] = map[h] ? vals[map[h] - 1] : ''; });
    if (String(obj.CheckID || '').trim() || String(obj.EventID || '').trim() ||
        String(obj.PartnerID || '').trim()) {
      out.push(obj);
    }
  });
  return out;
}

/**
 * Write a CapacityChecks object across a row by header name, then re-apply the
 * Status dropdown to that row (so a freshly appended row past the pre-validated
 * range still constrains Status). Mirrors writeLinkRow_.
 */
function writeCapacityRow_(sheet, row, obj, map) {
  const spec = CONFIG.SHEETS.CAPACITY;
  map = map || headerMap_(sheet);
  const width = Math.max(sheet.getLastColumn(), spec.headers.length);
  const range = sheet.getRange(row, 1, 1, width);
  const rowVals = range.getValues()[0];
  spec.headers.forEach(function(h) {
    if (!map[h]) return;
    const v = obj[h];
    rowVals[map[h] - 1] = (v === undefined || v === null) ? '' : v;
  });
  range.setValues([rowVals]);
  if (map.Status) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(spec.dropdowns.Status, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(row, map.Status).setDataValidation(rule);
  }
}

/**
 * Ensure the CapacityChecks tab has its header row — laying down the full set if
 * blank, or appending any missing spec header — so a capacity write never lands
 * in a header-less sheet. Mirrors ensureLinkHeaders_.
 */
function ensureCapacityHeaders_(sheet) {
  const spec = CONFIG.SHEETS.CAPACITY;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  if (existing.every(function(h) { return !h; })) {
    sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
    return;
  }
  spec.headers.forEach(function(h) {
    if (existing.indexOf(h) === -1) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(h);
      existing.push(h);
    }
  });
}

// ===========================================================================
// Phase 5 — Find Nearby Pantries (leader-initiated recommender)
// ===========================================================================
//
// Any time (not gated on a shortfall), a leader can pick an event and see the
// nearest partners from the FULL universe (candidate + active; paused excluded)
// that aren't already linked to it — with each one's pathway, capacity, and
// contact — so they can reach out. Internal-only (runs inside the gated sheet);
// contact fields are shown to the leader but never published.

/** Open the Find Nearby Pantries dialog. */
function openFindPantriesDialog() {
  const html = HtmlService.createHtmlOutputFromFile('FindPantriesDialog')
    .setWidth(600).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Find Nearby Pantries');
}

/**
 * Events for the Find Nearby Pantries picker, from the read-only Events_Reference
 * mirror. `hasCoords` lets the dialog warn when an event has no coordinates (then
 * results are ranked by capacity rather than distance).
 */
function getFindPantriesData() {
  const events = readEventsReference_().map(function(e) {
    return { id: e.EventID, label: eventLabel_(e),
             hasCoords: validLatLng_(e.Latitude, e.Longitude),
             paused: String(e.Paused || '').trim().toLowerCase() === 'yes' };
  });
  return { events: events, hasEvents: events.length > 0 };
}

/**
 * The nearest partners to an event for the leader to consider — the full
 * candidate+active universe minus partners already linked to that event, ranked
 * by distance (or capacity if the event has no coordinates). Returns name,
 * distance, pathway, capacity, and contact (PRD §7.3, leader-initiated).
 */
function findNearbyPantries(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return { eventId: '', eventLabel: '', byCapacity: false, hasEventCoords: false, items: [] };

  const ev = readEventsReference_().filter(function(e) { return e.EventID === id; })[0];
  const linked = {};
  readAllLinks_().forEach(function(l) { if (l.EventID === id) linked[l.PartnerID] = true; });

  const res = nearestPartnersForEvent_(id, linked, FIND_PANTRIES_LIMIT);
  return {
    eventId: id,
    eventLabel: ev ? eventLabel_(ev) : ('Event ' + id),
    byCapacity: res.byCapacity,
    hasEventCoords: res.hasEventCoords,
    items: res.items
  };
}

// ===========================================================================
// Phase 5 — Seed Pantries from Google Places
// ===========================================================================
//
// For each geocoded event in Events_Reference, query the Google Places API (New)
// for food pantries / food banks / soup kitchens within ~15 miles (configurable),
// keep the ~20 nearest, and append them to Partners as UNVERIFIED candidates
// (partnership_status = candidate, source = places, blank last_verified). These
// are leads for human review — pathway / cold_storage are intentionally left
// blank (the Edit Partner dialog enforces them before a record is trusted /
// activated), and nothing is auto-promoted to active.
//
// Dedup: a place is skipped if an existing partner shares its normalized name and
// sits within ~0.1 mi — so existing active partners are never re-added. The key
// is a SEPARATE server-side Places API key (Script Property PLACES_API_KEY), NOT
// the referrer-restricted browser Maps key the public map uses.

/**
 * Seed candidate pantries from Google Places for every geocoded event.
 *
 * Resumable + time-bounded so a large run never dies on Apps Script's ~6-min
 * execution cap: it processes events until PLACES_TIME_BUDGET_MS, flushes the
 * rows it gathered in ONE batched write, and records which events it finished in
 * a Script Property (PLACES_SEEDED_EVENTS). Re-run to continue where it left off;
 * when every event is done the cursor is cleared (a later run re-seeds fresh,
 * deduped). Fetches happen outside the lock; the batched append takes the lock.
 */
function seedPantries() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty(PLACES_PROPS.API_KEY) || '').trim();
  if (!apiKey) {
    ui.alert('Places API key missing',
      'Set a server-side Google Places API key first.\n\n' +
      'In the Apps Script editor: Project Settings ▸ Script Properties ▸ add a ' +
      'property named "' + PLACES_PROPS.API_KEY + '" with your Places API (New) key.\n\n' +
      'Use a SEPARATE key from the public map\'s browser key — this one runs ' +
      'server-side and must NOT be HTTP-referrer-restricted (restrict it to the ' +
      'Places API instead).',
      ui.ButtonSet.OK);
    return;
  }

  const radiusMiles = Number(props.getProperty(PLACES_PROPS.RADIUS_MILES)) || PLACES_DEFAULTS.RADIUS_MILES;
  const maxPerEvent = Math.max(1, Math.round(Number(props.getProperty(PLACES_PROPS.MAX_PER_EVENT)) || PLACES_DEFAULTS.MAX_PER_EVENT));
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  const geoEvents = readEventsReference_().filter(function(e) {
    return validLatLng_(e.Latitude, e.Longitude);
  });
  if (!geoEvents.length) {
    ui.alert('No geocoded events',
      'No events in Events_Reference have coordinates to search around. Run ' +
      'FTC ▸ Refresh Events first (the public Events sheet supplies lat/long), ' +
      'then try again.',
      ui.ButtonSet.OK);
    return;
  }

  // Resume cursor: skip events already finished in this pass. If none remain, the
  // previous pass completed — start a fresh one.
  const done = parseIdSet_(props.getProperty(PLACES_PROPS.SEEDED_EVENTS));
  let remaining = geoEvents.filter(function(e) { return !done[String(e.EventID)]; });
  if (!remaining.length) {
    Object.keys(done).forEach(function(k) { delete done[k]; });
    remaining = geoEvents.slice();
  }

  // Existing partner signatures for dedup (normalized name + coords). Grown as we
  // stage inserts so the same pantry near two events is only added once this run.
  const sigs = readAllPartners_().map(function(p) {
    return { name: normalizeName_(p.organization_name),
             lat: Number(p.latitude), lng: Number(p.longitude) };
  });

  let duplicates = 0, eventsSearched = 0, apiErrors = 0, lastError = '';
  let timedOut = false;
  const toAppend = [];
  const start = Date.now();

  for (let i = 0; i < remaining.length; i++) {
    if (Date.now() - start > PLACES_TIME_BUDGET_MS) { timedOut = true; break; }
    const ev = remaining[i];
    const lat = Number(ev.Latitude), lng = Number(ev.Longitude);

    let places;
    try {
      places = placesNearbyPantries_(apiKey, lat, lng, radiusMeters);
    } catch (err) {
      apiErrors++;
      lastError = String(err && err.message ? err.message : err);
      // A failure before any event has succeeded is almost certainly a key /
      // billing / API-not-enabled problem — abort loudly instead of grinding
      // through every event with the same error.
      if (eventsSearched === 0) {
        ui.alert('Seed Pantries failed',
          'The Places API call failed before any event could be searched:\n\n' +
          lastError + '\n\nCheck that ' + PLACES_PROPS.API_KEY + ' is a valid ' +
          'Places API (New) key, that billing + the Places API (New) are enabled ' +
          'on its Google Cloud project, and that the key is NOT HTTP-referrer-' +
          'restricted.',
          ui.ButtonSet.OK);
        return;
      }
      continue; // transient — skip this event, leave it out of the cursor to retry
    }
    eventsSearched++;
    done[String(ev.EventID)] = true;

    const ranked = places.map(function(pl) {
      pl._dist = (validLatLng_(pl.lat, pl.lng)) ? haversineMiles_(lat, lng, pl.lat, pl.lng) : Infinity;
      return pl;
    }).filter(function(pl) { return pl._dist <= radiusMiles; })
      .sort(function(a, b) { return a._dist - b._dist; })
      .slice(0, maxPerEvent);

    ranked.forEach(function(pl) {
      if (isDuplicatePartner_(pl.name, pl.lat, pl.lng, sigs)) { duplicates++; return; }
      toAppend.push(pl);
      sigs.push({ name: normalizeName_(pl.name), lat: pl.lat, lng: pl.lng });
    });
  }

  // Flush everything gathered this run in ONE batched write (per-row writes are
  // what blew the execution cap before).
  if (toAppend.length) {
    withLock_(function() {
      const sheet = getOrCreateSheet_(CONFIG.SHEETS.PARTNERS.name);
      ensurePartnerHeaders_(sheet);
      const now = new Date();
      appendPartnerRowsBatched_(sheet, toAppend.map(function(pl) {
        return placeToPartnerDraft_(pl, now);
      }));
    });
  }

  // Persist progress. When the whole set is done, clear the cursor so the next
  // run starts a fresh pass.
  const allDone = geoEvents.every(function(e) { return done[String(e.EventID)]; });
  if (allDone) props.deleteProperty(PLACES_PROPS.SEEDED_EVENTS);
  else props.setProperty(PLACES_PROPS.SEEDED_EVENTS, Object.keys(done).join(','));

  const seededTotal = Object.keys(done).length;
  const eventsLeft = geoEvents.length - seededTotal;
  ui.alert(allDone ? 'Pantries seeded — pass complete' : 'Pantries seeded — more to go',
    toAppend.length + ' candidate pantr' + (toAppend.length === 1 ? 'y' : 'ies') + ' added this run ' +
    '(partnership_status = candidate, source = places, blank last_verified).\n' +
    duplicates + ' skipped as duplicates.\n' +
    eventsSearched + ' event(s) searched within ' + radiusMiles + ' mi this run' +
    (apiErrors ? ' · ' + apiErrors + ' errored (' + lastError + ')' : '') + '.\n' +
    (allDone
      ? '\nAll ' + geoEvents.length + ' geocoded event(s) are done.'
      : '\n' + (timedOut ? 'Stopped at the time limit — ' : '') + eventsLeft +
        ' of ' + geoEvents.length + ' event(s) still to search. Run FTC ▸ Seed ' +
        'Pantries (Places) again to continue.') +
    '\n\nThese are UNVERIFIED leads. Qualify each via FTC ▸ Edit Partner — set ' +
    'pathway + cold_storage (required) — before linking or activating. None were ' +
    'auto-promoted to active.',
    ui.ButtonSet.OK);
}

/** Parse a comma-separated id list into a {id: true} set (blank → empty set). */
function parseIdSet_(raw) {
  const out = {};
  String(raw || '').split(',').forEach(function(s) {
    const id = s.trim();
    if (id) out[id] = true;
  });
  return out;
}

/**
 * Append many Partners rows in ONE setValues (plus a few block-validation calls),
 * instead of a per-row writePartnerRow_ loop — orders of magnitude fewer Sheets
 * round-trips, which is what kept a large seed under the execution cap. Writes
 * each draft field into its actual column (by header map), so column order /
 * extra columns are respected.
 */
function appendPartnerRowsBatched_(sheet, drafts) {
  if (!drafts.length) return;
  const spec = CONFIG.SHEETS.PARTNERS;
  const map = headerMap_(sheet);
  const startRow = sheet.getLastRow() + 1;
  const width = Math.max(sheet.getLastColumn(), spec.headers.length);

  const values = drafts.map(function(d) {
    const row = [];
    for (let c = 0; c < width; c++) row.push('');
    spec.headers.forEach(function(h) {
      if (!map[h]) return;
      const v = d[h];
      row[map[h] - 1] = (v === undefined || v === null) ? '' : v;
    });
    return row;
  });
  sheet.getRange(startRow, 1, values.length, width).setValues(values);

  // Block validation for the appended range (one call per dropdown / checkbox col).
  Object.keys(spec.dropdowns).forEach(function(h) {
    if (!map[h]) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(spec.dropdowns[h], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(startRow, map[h], values.length, 1).setDataValidation(rule);
  });
  (spec.checkboxes || []).forEach(function(h) {
    if (map[h]) sheet.getRange(startRow, map[h], values.length, 1).insertCheckboxes();
  });
}

/**
 * Run every PLACES_QUERIES term as a Places Text Search around (lat,lng) and merge
 * the results, deduped by place id. Returns normalized place objects.
 */
function placesNearbyPantries_(apiKey, lat, lng, radiusMeters) {
  const byId = {};
  PLACES_QUERIES.forEach(function(q) {
    placesTextSearch_(apiKey, q, lat, lng, radiusMeters).forEach(function(pl) {
      const id = pl.id || (normalizeName_(pl.name) + '|' + pl.lat + '|' + pl.lng);
      if (!byId[id]) byId[id] = pl;
    });
  });
  return Object.keys(byId).map(function(k) { return byId[k]; });
}

/**
 * One Places API (New) Text Search call (places:searchText) biased to a circle.
 * Returns up to 20 normalized place objects. Throws a friendly error on non-200.
 * The API key goes in the X-Goog-Api-Key header; a field mask limits the response
 * (and the billing SKU) to just the fields we store.
 */
function placesTextSearch_(apiKey, query, lat, lng, radiusMeters) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const payload = {
    textQuery: query,
    maxResultCount: 20,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } }
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
        'places.nationalPhoneNumber', 'places.regularOpeningHours.weekdayDescriptions',
        'places.types'
      ].join(',')
    },
    payload: JSON.stringify(payload)
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code !== 200) {
    let msg = 'Places API returned HTTP ' + code;
    try { const e = JSON.parse(text); if (e && e.error && e.error.message) msg += ' — ' + e.error.message; } catch (ignore) {}
    throw new Error(msg);
  }
  const data = JSON.parse(text || '{}');
  return (data.places || []).map(parsePlace_);
}

/** Normalize one Places (New) result into the fields we store on a Partner row. */
function parsePlace_(pl) {
  const loc = pl.location || {};
  const address = String(pl.formattedAddress || '').trim();
  const parsed = parseUsAddress_(address);
  const hours = (pl.regularOpeningHours && pl.regularOpeningHours.weekdayDescriptions || []).join('; ');
  return {
    id: String(pl.id || ''),
    name: String((pl.displayName && pl.displayName.text) || '').trim(),
    address: address,
    city: parsed.city, state: parsed.state, postal: parsed.postal,
    lat: Number(loc.latitude), lng: Number(loc.longitude),
    phone: String(pl.nationalPhoneNumber || '').trim(),
    hours: hours,
    types: pl.types || []
  };
}

/** Best-effort parse of "…, City, ST 12345, USA" → {city, state, postal}. */
function parseUsAddress_(address) {
  const m = String(address || '').match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})(?:-\d{4})?/);
  if (m) return { city: m[1].trim(), state: m[2], postal: m[3] };
  return { city: '', state: '', postal: '' };
}

/** Pick a human service_name from the Places type list. */
function serviceNameFromTypes_(types) {
  const t = (types || []).map(function(x) { return String(x).toLowerCase(); });
  if (t.indexOf('food_bank') !== -1) return 'Food bank';
  if (t.indexOf('soup_kitchen') !== -1) return 'Soup kitchen';
  return 'Food pantry';
}

/**
 * Build a Partners draft from a seeded place. partnership_status = candidate,
 * source = places, blank last_verified — and pathway / cold_storage left BLANK on
 * purpose (unknown until a human qualifies the lead; Edit Partner enforces them).
 * Phone goes into the internal contact_phone; hours into the hours column.
 */
function placeToPartnerDraft_(pl, now) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const draft = {};
  spec.headers.forEach(function(h) { draft[h] = ''; });
  draft.PartnerID = Utilities.getUuid();
  draft.organization_name = pl.name;
  draft.address = pl.address;
  draft.city = pl.city;
  draft.state = pl.state;
  draft.postal_code = pl.postal;
  if (validLatLng_(pl.lat, pl.lng)) { draft.latitude = pl.lat; draft.longitude = pl.lng; }
  draft.service_name = serviceNameFromTypes_(pl.types);
  draft.contact_phone = pl.phone;
  draft.partnership_status = 'candidate';
  draft.agreement_on_file = false;
  draft.last_verified = '';   // blank — unconfirmed, needs human review
  draft.FirstAdded = now;
  draft.source = 'places';
  draft.hours = pl.hours;
  return draft;
}

/** Lowercase, strip punctuation, collapse whitespace — for name-based dedup. */
function normalizeName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * True if a candidate duplicates an existing partner: same normalized name AND
 * within PLACES_DUP_MILES (or same name when coordinates are missing on either
 * side — we can't disprove proximity, so we err toward NOT re-adding).
 */
function isDuplicatePartner_(name, lat, lng, sigs) {
  const nn = normalizeName_(name);
  if (!nn) return false;
  for (let i = 0; i < sigs.length; i++) {
    if (sigs[i].name !== nn) continue;
    const both = validLatLng_(lat, lng) && validLatLng_(sigs[i].lat, sigs[i].lng);
    if (!both) return true;
    if (haversineMiles_(lat, lng, sigs[i].lat, sigs[i].lng) <= PLACES_DUP_MILES) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 3a — link / event read helpers
// ---------------------------------------------------------------------------

/** Sort link rows: active first, then by label. */
function linkLabelSort_(a, b) {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return String(a.label).toLowerCase() < String(b.label).toLowerCase() ? -1 : 1;
}

/** Coerce a stored flag (checkbox bool, or "true"/"yes" text) to a boolean. */
function isTruthyFlag_(v) {
  return v === true || ['true', 'yes', 'on', '1'].indexOf(String(v).trim().toLowerCase()) !== -1;
}

/** "City — Venue" label for an event (falls back gracefully if a part is blank). */
function eventLabel_(e) {
  const city = String(e.City || '').trim();
  const state = String(e.State || '').trim();
  const venue = String(e.Venue || '').trim();
  const place = city + (state ? ', ' + state : '');
  if (place && venue) return place + ' — ' + venue;
  return place || venue || String(e.EventID || '').trim();
}

/** "City, ST" location string for a partner (dialog context line). */
function partnerLocation_(p) {
  const city = String(p.city || '').trim();
  const state = String(p.state || '').trim();
  return city + (state ? ', ' + state : '');
}

/** All partners as objects keyed by header, sorted by org name (id + name present). */
function readAllPartners_() {
  const spec = CONFIG.SHEETS.PARTNERS;
  const sheet = getOrCreateSheet_(spec.name);
  const rows = readAllRows_(sheet, spec.headers);
  return rows.filter(function(r) {
    return String(r.PartnerID || '').trim() && String(r.organization_name || '').trim();
  }).sort(function(a, b) {
    return String(a.organization_name).toLowerCase() < String(b.organization_name).toLowerCase() ? -1 : 1;
  });
}

/** All events from the read-only mirror, sorted by label (only rows with an EventID). */
function readEventsReference_() {
  const spec = CONFIG.EVENTS_REF;
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(spec.name);
  if (!sheet) return [];
  const rows = readAllRows_(sheet, spec.headers);
  return rows.filter(function(r) { return String(r.EventID || '').trim(); })
    .sort(function(a, b) {
      return eventLabel_(a).toLowerCase() < eventLabel_(b).toLowerCase() ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// Section 1 — Leaders + the leader/primary-partner resolver
// ---------------------------------------------------------------------------

/** All Leaders rows as objects (rows with a name OR email). */
function readAllLeaders_() {
  const spec = CONFIG.SHEETS.LEADERS;
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(spec.name);
  if (!sheet) return [];
  return readAllRows_(sheet, spec.headers)
    .filter(function(r) { return String(r.leader_name || '').trim() || String(r.leader_email || '').trim(); })
    .map(function(r) {
      return {
        name: String(r.leader_name || '').trim(),
        email: String(r.leader_email || '').trim(),
        chapter: String(r.chapter || '').trim(),
        active: isTruthyFlag_(r.active),
        notes: String(r.notes || '').trim()
      };
    });
}

/**
 * Resolve an event's chapter leader by matching the event's `Leader` (a first
 * name from the public Events sheet) to a Leaders-tab row. Prefers an active
 * match; on a tie of first names, takes the first. Returns a result that always
 * carries a `flag` string when the leader can't be cleanly reminded (no leader
 * name on the event, no Leaders row, matched row missing an email, inactive, or
 * an ambiguous first-name match) — so the caller can surface it rather than fail
 * silently.
 */
function resolveEventLeader_(ev, leaders) {
  leaders = leaders || readAllLeaders_();
  const raw = String(ev.Leader || '').trim();
  const result = { eventLeaderName: raw, name: '', email: '', chapter: '',
                   matched: false, active: false, ambiguous: false, flag: '' };
  if (!raw) {
    result.flag = 'This event has no leader name in Events_Reference — set one on the public Events sheet, then Refresh Events.';
    return result;
  }
  const first = (raw.split(/\s+/)[0] || '').toLowerCase();
  const matches = leaders.filter(function(l) {
    const lfirst = (l.name.split(/\s+/)[0] || '').toLowerCase();
    return lfirst === first || l.name.toLowerCase() === raw.toLowerCase();
  });
  if (!matches.length) {
    result.flag = 'No Leaders row matches “' + raw + '”. Add them on the Leaders tab (leader_name, leader_email).';
    return result;
  }
  const pick = matches.filter(function(l) { return l.active; })[0] || matches[0];
  result.matched = true;
  result.name = pick.name;
  result.email = pick.email;
  result.chapter = pick.chapter;
  result.active = pick.active;
  result.ambiguous = matches.length > 1;
  if (!pick.email) result.flag = 'Leader “' + pick.name + '” has no email on the Leaders tab.';
  else if (!pick.active) result.flag = 'Leader “' + pick.name + '” is marked inactive on the Leaders tab.';
  else if (result.ambiguous) result.flag = 'Multiple leaders share the first name “' + raw + '” — using “' + pick.name + '”. Disambiguate on the Leaders tab if wrong.';
  return result;
}

/**
 * The PRIMARY partner linked to an event (the link with is_primary = TRUE),
 * joined to its Partners row. Returns null when no primary is set. `partnersById`
 * / `links` may be passed pre-read to avoid re-reads inside a loop.
 */
function resolveEventPrimaryPartner_(eventId, partnersById, links) {
  if (!partnersById) {
    partnersById = {};
    readAllPartners_().forEach(function(p) { partnersById[p.PartnerID] = p; });
  }
  links = links || readAllLinks_();
  const primaries = links.filter(function(l) {
    return l.EventID === eventId && isTruthyFlag_(l.is_primary);
  });
  if (!primaries.length) return null;
  const l = primaries[0];
  const p = partnersById[l.PartnerID];
  return {
    partnerId: l.PartnerID,
    found: !!p,
    name: p ? p.organization_name : ('Unknown partner (' + l.PartnerID + ')'),
    location: p ? partnerLocation_(p) : '',
    pathway: p ? String(p.pathway || '').trim() : '',
    cold_storage: p ? String(p.cold_storage || '').trim() : '',
    capacity: p ? (Number(p.monthly_capacity_meals) || 0) : 0,
    recurring_slot: String(l.recurring_slot || '').trim(),
    active: isTruthyFlag_(l.active),
    multiple: primaries.length > 1,
    contactName: p ? String(p.contact_name || '').trim() : '',
    contactPhone: p ? String(p.contact_phone || '').trim() : '',
    contactEmail: p ? String(p.contact_email || '').trim() : ''
  };
}

/**
 * Public resolver (Section 1): given an EventID, return its leader (matched to
 * the Leaders tab, flagged if no clean email match) and its primary partner.
 * Used by the reminder workflow and the reminder dialog. Internal-only — the
 * primary partner carries contact fields, which are never published.
 */
function resolveEventLeaderAndPrimary(eventId) {
  const id = String(eventId || '').trim();
  const ev = readEventsReference_().filter(function(e) { return e.EventID === id; })[0];
  if (!ev) return { eventId: id, found: false, eventLabel: '', leader: null, primary: null };
  return {
    eventId: id,
    found: true,
    eventLabel: eventLabel_(ev),
    saturday: String(ev.Saturday || '').trim(),
    time: String(ev.Time || '').trim(),
    leader: resolveEventLeader_(ev),
    primary: resolveEventPrimaryPartner_(id)
  };
}

/**
 * All link rows as objects keyed by header, each tagged with its 1-based sheet
 * row in `_row`. Optionally pass a pre-read sheet + header map to avoid a
 * re-read inside the upsert.
 */
function readAllLinks_(sheet, map) {
  const spec = CONFIG.SHEETS.LINKS;
  sheet = sheet || getOrCreateSheet_(spec.name);
  map = map || headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = [];
  values.forEach(function(vals, i) {
    const obj = { _row: i + 2 };
    spec.headers.forEach(function(h) { obj[h] = map[h] ? vals[map[h] - 1] : ''; });
    // Skip fully blank rows (e.g. trailing empties).
    if (String(obj.LinkID || '').trim() || String(obj.EventID || '').trim() ||
        String(obj.PartnerID || '').trim()) {
      out.push(obj);
    }
  });
  return out;
}

/** Generic: read every data row of a sheet into objects keyed by `headers`. */
function readAllRows_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const map = headerMap_(sheet);
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function(vals) {
    const obj = {};
    headers.forEach(function(h) { obj[h] = map[h] ? vals[map[h] - 1] : ''; });
    return obj;
  });
}

/**
 * Write a link object across an EventPartnerLinks row by header name, then
 * re-apply the `active` checkbox to that row (so a freshly appended row past the
 * pre-validated range still renders as a checkbox). Mirrors writePartnerRow_.
 */
function writeLinkRow_(sheet, row, obj, map) {
  const spec = CONFIG.SHEETS.LINKS;
  map = map || headerMap_(sheet);
  const width = Math.max(sheet.getLastColumn(), spec.headers.length);
  const range = sheet.getRange(row, 1, 1, width);
  const rowVals = range.getValues()[0];
  spec.headers.forEach(function(h) {
    if (!map[h]) return;
    const v = obj[h];
    rowVals[map[h] - 1] = (v === undefined || v === null) ? '' : v;
  });
  range.setValues([rowVals]);
  (spec.checkboxes || []).forEach(function(h) {
    if (map[h]) sheet.getRange(row, map[h]).insertCheckboxes();
  });
}

/**
 * Ensure the EventPartnerLinks tab has its header row, laying down the full set
 * if the row is blank or appending any missing spec header. Mirrors
 * ensurePartnerHeaders_ so a link save never lands in a header-less sheet.
 */
function ensureLinkHeaders_(sheet) {
  const spec = CONFIG.SHEETS.LINKS;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  if (existing.every(function(h) { return !h; })) {
    sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
    return;
  }
  spec.headers.forEach(function(h) {
    if (existing.indexOf(h) === -1) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(h);
      existing.push(h);
    }
  });
}

/**
 * Auto-fill the UUID id column (PartnerID / LinkID) when a new row gains
 * content. Simple trigger — runs without extra authorization.
 *
 * Ghost-row guard: a row only earns an ID once it has real content in some
 * non-id column, so a stray edit in a blank row never mints an orphan ID.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const spec = sheetSpecByName_(sheet.getName());
  if (!spec) return;

  const map = headerMap_(sheet);
  const idCol = map[spec.idColumn];
  if (!idCol) return;

  const firstRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  for (let r = firstRow; r < firstRow + numRows; r++) {
    if (r === 1) continue; // header
    const idCell = sheet.getRange(r, idCol);
    if (String(idCell.getValue()).trim() !== '') continue; // already has an id
    if (!rowHasUserContent_(sheet, r, map, spec)) continue;
    idCell.setValue(Utilities.getUuid());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up a single tab from its spec: headers, styling, validation. */
function setupOneSheet_(spec) {
  const sheet = getOrCreateSheet_(spec.name);
  const n = spec.headers.length;
  const map = headerMapFromSpec_(spec);

  // Header row (canonical text, in order).
  sheet.getRange(1, 1, 1, n).setValues([spec.headers]);
  sheet.getRange(1, 1, 1, n)
    .setBackground(CONFIG.COLORS.HEADER_BG)
    .setFontColor(CONFIG.COLORS.HEADER_TEXT)
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidths(1, n, 170);

  // Required-field hint, shown on hover over the header cell.
  spec.required.forEach(function(h) {
    sheet.getRange(1, map[h]).setNote('Required');
  });

  // Dropdown + checkbox validation across the whole column below the header.
  const bodyRows = sheet.getMaxRows() - 1;
  if (bodyRows > 0) {
    Object.keys(spec.dropdowns).forEach(function(h) {
      if (!map[h]) return;
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(spec.dropdowns[h], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, map[h], bodyRows, 1).setDataValidation(rule);
    });
    (spec.checkboxes || []).forEach(function(h) {
      if (!map[h]) return;
      sheet.getRange(2, map[h], bodyRows, 1).insertCheckboxes();
    });
  }
}

/** True if any non-id cell in the row holds real content (false/blank ignored). */
function rowHasUserContent_(sheet, row, map, spec) {
  const values = sheet.getRange(row, 1, 1, spec.headers.length).getValues()[0];
  const idIndex = map[spec.idColumn] - 1;
  for (let i = 0; i < values.length; i++) {
    if (i === idIndex) continue;
    const v = values[i];
    if (v === '' || v === null || v === false) continue;
    if (String(v).trim() === '') continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Partner add/edit helpers (Phase 2b)
// ---------------------------------------------------------------------------

/**
 * Coerce a form payload into a clean partner draft keyed by the canonical
 * Partners headers. Trims text, upper-cases the state, and turns
 * agreement_on_file into a real boolean (the sheet stores it as a checkbox).
 */
function normalizePartnerDraft_(data) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const out = {};
  spec.headers.forEach(function(h) {
    out[h] = (data[h] === undefined || data[h] === null) ? '' : data[h];
  });
  out.organization_name = String(out.organization_name || '').trim();
  out.address = String(out.address || '').trim();
  out.city = String(out.city || '').trim();
  out.state = String(out.state || '').trim().toUpperCase();
  out.postal_code = String(out.postal_code || '').trim();
  out.pathway = String(out.pathway || '').trim();
  out.cold_storage = String(out.cold_storage || '').trim();
  out.partnership_status = String(out.partnership_status || '').trim();
  const a = out.agreement_on_file;
  out.agreement_on_file = (a === true ||
    ['true', 'yes', 'on', '1'].indexOf(String(a).trim().toLowerCase()) !== -1);
  return out;
}

/**
 * Validate the food-safety-critical fields. Returns an array of human-readable
 * errors (empty = valid). Enforced server-side as well as in the dialog so a
 * record can never reach the sheet without a legal pathway + cold-storage state
 * (AGENTS.md hard rule #4; PRD §6; TFER §228.64).
 */
function validatePartnerDraft_(draft) {
  const errors = [];
  if (!String(draft.organization_name || '').trim()) errors.push('Organization name is required.');
  if (!String(draft.address || '').trim()) errors.push('Address is required.');

  const pathway = String(draft.pathway || '').trim();
  if (CONFIG.SHEETS.PARTNERS.dropdowns.pathway.indexOf(pathway) === -1) {
    errors.push('Pathway is required (same-day or hold-redistribute).');
  }
  const cold = String(draft.cold_storage || '').trim();
  if (CONFIG.SHEETS.PARTNERS.dropdowns.cold_storage.indexOf(cold) === -1) {
    errors.push('Cold storage is required (yes or no).');
  }
  // The legal gate: the hold-and-redistribute pathway requires cold storage.
  if (pathway === 'hold-redistribute' && cold !== 'yes') {
    errors.push('Hold-and-redistribute requires cold storage = yes — the food must be kept ≤41°F (TFER §228.64). Switch the pathway to same-day or confirm cold storage.');
  }
  return errors;
}

/** A normalized address signature used to detect "did the address change?". */
function partnerAddressSig_(o) {
  return ['address', 'city', 'state', 'postal_code']
    .map(function(k) { return String((o && o[k]) || '').trim().toLowerCase(); })
    .join('|');
}

/** Join the address parts into a single geocoder query string. */
function partnerGeocodeQuery_(draft) {
  const parts = [];
  ['address', 'city', 'state', 'postal_code'].forEach(function(k) {
    const v = String(draft[k] || '').trim();
    if (v) parts.push(v);
  });
  return parts.join(', ');
}

/**
 * Geocode the partner address ONCE and cache lat/long on the draft.
 *
 * Skips entirely when valid coordinates are already present (the "skip if
 * already present" rule, PRD §5). Uses Apps Script's keyless built-in geocoder
 * — Maps.newGeocoder() — exactly like the event map. This is NOT the public
 * map's Maps JS key, and nothing here is ever served publicly. Returns
 * { ok, source } on success or { ok:false, message } on failure; failure is
 * non-fatal (the row still saves, just without a pin).
 */
function fillPartnerCoordinates_(draft) {
  if (validLatLng_(draft.latitude, draft.longitude)) {
    return { ok: true, source: 'Existing coordinates' };
  }
  const query = partnerGeocodeQuery_(draft);
  if (!query) return { ok: false, message: 'No address was available to geocode.' };

  try {
    const result = Maps.newGeocoder().setRegion('us').geocode(query);
    if (result.status === 'OK' && result.results && result.results.length) {
      const loc = result.results[0].geometry.location;
      draft.latitude = loc.lat;
      draft.longitude = loc.lng;
      return { ok: true, source: 'Geocoded address' };
    }
    return { ok: false, message: 'Could not geocode “' + query + '” (status ' + result.status + '). The row was saved without a map pin — fix the address and re-save.' };
  } catch (err) {
    return { ok: false, message: 'Geocoder error: ' + err.message };
  }
}

/** True when lat/long are real, finite, in-range, and not the null island. */
function validLatLng_(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
}

/** Read one Partners row into an object keyed by the canonical headers. */
function readPartnerRow_(sheet, row) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const map = headerMap_(sheet);
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const obj = {};
  spec.headers.forEach(function(h) {
    obj[h] = map[h] ? values[map[h] - 1] : '';
  });
  return obj;
}

/**
 * Write a partner object across the Partners row, by header name. Preserves any
 * columns not in the spec, then re-applies the row's dropdown + checkbox
 * validation so a freshly appended row (past the pre-validated range) still
 * gets them.
 */
function writePartnerRow_(sheet, row, obj) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const map = headerMap_(sheet);
  const width = Math.max(sheet.getLastColumn(), spec.headers.length);
  const range = sheet.getRange(row, 1, 1, width);
  const rowVals = range.getValues()[0];
  spec.headers.forEach(function(h) {
    if (!map[h]) return;
    const v = obj[h];
    rowVals[map[h] - 1] = (v === undefined || v === null) ? '' : v;
  });
  range.setValues([rowVals]);
  applyPartnerRowValidation_(sheet, row, map);
}

/** Re-apply dropdown + checkbox data validation to a single Partners row. */
function applyPartnerRowValidation_(sheet, row, map) {
  const spec = CONFIG.SHEETS.PARTNERS;
  Object.keys(spec.dropdowns).forEach(function(h) {
    if (!map[h]) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(spec.dropdowns[h], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(row, map[h]).setDataValidation(rule);
  });
  (spec.checkboxes || []).forEach(function(h) {
    if (!map[h]) return;
    sheet.getRange(row, map[h]).insertCheckboxes();
  });
}

/**
 * Ensure the Partners tab has its header row. If the row is blank, lay down the
 * full header set. Otherwise append any spec header that's missing (e.g. the
 * FirstAdded column added in Phase 2b) so an Add/Edit save never lands in a
 * sheet that predates a schema column.
 */
function ensurePartnerHeaders_(sheet) {
  const spec = CONFIG.SHEETS.PARTNERS;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  if (existing.every(function(h) { return !h; })) {
    sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
    return;
  }
  spec.headers.forEach(function(h) {
    if (existing.indexOf(h) === -1) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(h);
      existing.push(h);
    }
  });
}

/** The active row on the Partners tab (>= 2), or null if not on that tab. */
function getActivePartnerRow_() {
  const active = SpreadsheetApp.getActiveSheet();
  if (!active || active.getName() !== CONFIG.SHEETS.PARTNERS.name) return null;
  const row = active.getActiveCell().getRow();
  return row >= 2 ? row : null;
}

/** Column map {header: 1-based index} read from a sheet's header row. */
function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach(function(h, i) { if (h !== '' && h !== null) map[h] = i + 1; });
  return map;
}

/** Column map {header: 1-based index} derived from a spec's header order. */
function headerMapFromSpec_(spec) {
  const map = {};
  spec.headers.forEach(function(h, i) { map[h] = i + 1; });
  return map;
}

/** Find the sheet spec whose tab name matches, or null. */
function sheetSpecByName_(name) {
  const keys = Object.keys(CONFIG.SHEETS);
  for (let i = 0; i < keys.length; i++) {
    if (CONFIG.SHEETS[keys[i]].name === name) return CONFIG.SHEETS[keys[i]];
  }
  return null;
}

/** Get a tab by name, creating it if missing. */
function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Drop the auto-created "Sheet1" if it's still empty (cosmetic cleanup). */
function removeDefaultSheetIfEmpty_() {
  const ss = SpreadsheetApp.getActive();
  const def = ss.getSheetByName('Sheet1');
  if (!def) return;
  if (def.getLastRow() >= 1 || def.getLastColumn() >= 2) return; // has data
  if (ss.getSheets().length <= 1) return; // never delete the last sheet
  try { ss.deleteSheet(def); } catch (err) { /* leave it if delete fails */ }
}

/**
 * Run a function while holding the document lock so concurrent edits can't
 * race on a read-then-write. Mirrors the event-map's withLock_.
 */
function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Sheet is busy — another change is in progress. Try again in a moment.');
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (err) { /* ignore release errors */ }
  }
}
