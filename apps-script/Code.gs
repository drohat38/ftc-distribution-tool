/**
 * FTC Distribution Tool — Apps Script admin (Phase 2a: data foundation).
 *
 * Bound to the PRIVATE "FTC Distribution (Partners)" workbook — a separate
 * workbook from the public event-map Events sheet (the privacy wall). See
 * AGENTS.md and PRD.md.
 *
 * This file builds the data foundation only:
 *   - "FTC" menu with "Set up sheets" and an "Add Partner" stub.
 *   - "Set up sheets" creates the Partners and EventPartnerLinks tabs with the
 *     exact header rows from docs/DATA_MODEL.md, brand-styled headers, and
 *     dropdown validation (pathway / cold_storage / partnership_status).
 *   - A simple onEdit trigger auto-fills PartnerID / LinkID with a UUID when a
 *     new row gains content.
 *
 * Schema is driven entirely by CONFIG.SHEETS below; the header arrays MUST stay
 * in lockstep with docs/DATA_MODEL.md (that file is the contract).
 *
 * Idioms (menu, headerMap_, withLock_, Utilities.getUuid, requireValueInList)
 * mirror the proven event-map Apps Script — read-only reference at
 * reference/feed-the-city-event-map/. Never modify that repo.
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
        'agreement_date', 'last_verified'
      ],
      required: ['PartnerID', 'organization_name', 'address', 'pathway', 'cold_storage'],
      dropdowns: {
        pathway: ['same-day', 'hold-redistribute'],
        cold_storage: ['yes', 'no'],
        partnership_status: ['candidate', 'active', 'paused']
      }
    },
    LINKS: {
      name: 'EventPartnerLinks',
      idColumn: 'LinkID',
      headers: [
        'LinkID', 'EventID', 'PartnerID', 'active',
        'recurring_slot', 'last_capacity_confirmed'
      ],
      required: ['LinkID', 'EventID', 'PartnerID', 'active'],
      dropdowns: {}
    }
  }
};

/**
 * Build the "FTC" menu. Kept tiny on purpose — Phase 2a is just the data
 * foundation. Richer admin (the Add Partner form, geocoding, status) lands in
 * later phases.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(CONFIG.MENU)
    .addItem('Set up sheets', 'setupSheets')
    .addSeparator()
    .addItem('Add Partner', 'addPartner')
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

/** Add Partner — stub. The real add/qualify form arrives in Phase 2b. */
function addPartner() {
  SpreadsheetApp.getUi().alert(
    'Add Partner (coming in Phase 2b)',
    'This will open a form to add and qualify a distribution partner — with ' +
    'pathway and cold storage required, per the food-safety rules.\n\n' +
    'For now, add a row directly on the Partners tab; the PartnerID is ' +
    'generated for you.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
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

  // Dropdown validation across the whole column below the header.
  const bodyRows = sheet.getMaxRows() - 1;
  if (bodyRows > 0) {
    Object.keys(spec.dropdowns).forEach(function(h) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(spec.dropdowns[h], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, map[h], bodyRows, 1).setDataValidation(rule);
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
