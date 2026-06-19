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
      // `active` becomes a checkbox with the link dialog in Phase 3 (DATA_MODEL.md).
      checkboxes: []
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
