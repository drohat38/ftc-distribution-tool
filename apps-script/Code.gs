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
    headers: [
      'EventID', 'City', 'State', 'Venue', 'Address',
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
        'agreement_date', 'last_verified', 'FirstAdded'
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
      headers: [
        'LinkID', 'EventID', 'PartnerID', 'active',
        'recurring_slot', 'last_capacity_confirmed'
      ],
      required: ['LinkID', 'EventID', 'PartnerID', 'active'],
      dropdowns: {},
      // `active` is a checkbox, switched on with the link dialog in Phase 3a
      // (DATA_MODEL.md Tab 2). The Link dialog upsert writes a real boolean here.
      checkboxes: ['active']
    }
  }
};

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

  SpreadsheetApp.getUi().alert(
    'Sheets ready',
    'The "Partners" and "EventPartnerLinks" tabs are set up with headers, ' +
    'dropdowns, and auto-UUID.\n\n' +
    'Add a row on either tab and its ID fills in automatically. pathway, ' +
    'cold_storage, and partnership_status are dropdowns.',
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
  const ui = SpreadsheetApp.getUi();
  let result;
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
    ui.alert('Refresh Events failed', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
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
          last_capacity_confirmed: existing.last_capacity_confirmed || ''
        };
        writeLinkRow_(sheet, existing._row, row, map);
        updated++;
        details.push({ eventId: eventId, label: label, action: 'updated' });
      } else {
        const row = {
          LinkID: Utilities.getUuid(),
          EventID: eventId,
          PartnerID: partnerId,
          active: active,
          recurring_slot: recurringSlot,
          last_capacity_confirmed: ''
        };
        writeLinkRow_(sheet, nextRow, row, map);
        index[partnerId + '|' + eventId] = { _row: nextRow }; // guard dup ids in same call
        nextRow++;
        created++;
        details.push({ eventId: eventId, label: label, action: 'created' });
      }
    });

    return {
      partnerName: partner.organization_name,
      created: created,
      updated: updated,
      skipped: skipped,
      active: active,
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
