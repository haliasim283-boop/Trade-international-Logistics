/**
 * Trade International Logistics — Google Sheet ⇄ Master Shipment Log
 *
 * Paste this into Extensions ▸ Apps Script on the shipment sheet.
 * See SETUP.md for the full walkthrough.
 *
 * Two-way, on one 15-minute cycle:
 *   UP    rows typed here are pushed into the system
 *   DOWN  shipments added or edited on the Master Shipment page are
 *         merged back into this sheet
 *
 * Everything is matched on AWB Number in both directions, so syncing
 * twice updates rather than duplicates.
 *
 * Deleting is one-way-safe by design: deleting a row here never
 * deletes the shipment, and deleting a shipment in the system does
 * not remove the row here.
 *
 * If the same AWB is changed in both places within one cycle, the
 * SYSTEM WINS — the push runs first, then the pull overwrites the
 * row with whatever the system ended up holding.
 */

// ── Column headers ────────────────────────────────────────────────
// Matched by NAME, not position — you can reorder or hide columns in
// the sheet and the sync still works. Renaming one will break it.

var REQUIRED_HEADERS = [
  'Flight Date',
  'AWB Number',
  'Client Name',
  'Origin',
  'Destination',
  'Chargeable Weight',
  'Net Rate',
];

// Sheet header  →  key the database function expects
var FIELD_MAP = {
  'Flight Date':          'flight_date',
  'AWB Number':           'awb_number',
  'Client Name':          'client_name',
  'Origin':               'origin',
  'Destination':          'destination',
  'Chargeable Weight':    'chargeable_weight',
  'Net Rate':             'net_rate',
  'Pieces':               'pieces',
  'Status':               'status',
  'USD Rate':             'pkr_exchange_rate',
  'CASS Airline Rate':    'cass_airline_rate',
  'Clearing Agent':       'clearing_agent',
  'Clearing Charges':     'clearing_charges',
  'IDC Tax':              'idc_tax',
  'Other Charges':        'other_charges',
  'AWB Fixed Fee':        'awb_fixed_fee',
  'Sales Agent':          'sales_agent',
  'SA Commission':        'sales_agent_commission_per_kg',
  'Form E Supplier':      'form_e_supplier',
  'Form E USD Rate':      'form_e_usd_rate_per_kg',
  'Form E PKR Receivable':'form_e_pkr_rate',
  'Form E PKR Payable':   'form_e_pkr_rate_payable',
  'Notes':                'notes',
};

// Written back by this script, never by hand
var STATUS_HEADER = 'Sync Status';
var TIME_HEADER   = 'Last Synced';
var HASH_HEADER   = 'Row Hash';   // hidden; lets us skip unchanged rows

var BATCH_SIZE = 50;
var IMPORT_PAGE_SIZE = 500;   // rows pulled per request when backfilling

// Watermark for the incremental pull: the timestamp the server told us
// to ask from next time. Stored as the server gave it — never built
// from this script's own clock, which is not the database's clock.
var LAST_PULL_KEY = 'LAST_PULL_AT';

// Most AWBs we bother telling the server to skip on a pull. Beyond
// this the round trip costs more than re-writing a few rows.
var MAX_EXCLUDE = 500;

// ── Menu ──────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TIL Sync')
    .addItem('Sync Now', 'syncChangedRows')
    .addItem('Re-sync ALL rows', 'syncAllRows')
    .addSeparator()
    .addItem('Pull updates from system', 'pullNow')
    .addItem('Import existing shipments from system', 'importExistingShipments')
    .addSeparator()
    .addItem('Setup — connect to system', 'showSetup')
    .addItem('Test connection', 'testConnection')
    .addSeparator()
    .addItem('Turn ON auto-sync (every 15 min)', 'installTrigger')
    .addItem('Turn OFF auto-sync', 'removeTrigger')
    .addToUi();
}

// ── Setup ─────────────────────────────────────────────────────────

function showSetup() {
  var ui    = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var url = ui.prompt(
    'Step 1 of 3 — Supabase URL',
    'e.g. https://xxxxxxxx.supabase.co',
    ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;

  var key = ui.prompt(
    'Step 2 of 3 — Supabase anon key',
    'Supabase dashboard ▸ Project Settings ▸ API ▸ anon public',
    ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() !== ui.Button.OK) return;

  var secret = ui.prompt(
    'Step 3 of 3 — Sync secret',
    'The same random string you saved into integration_settings.',
    ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;

  props.setProperties({
    SUPABASE_URL: url.getResponseText().trim().replace(/\/+$/, ''),
    SUPABASE_KEY: key.getResponseText().trim(),
    SYNC_SECRET:  secret.getResponseText().trim(),
  });

  ui.alert('Saved. Now run TIL Sync ▸ Test connection.');
}

function testConnection() {
  var ui = SpreadsheetApp.getUi();
  try {
    callSync([]);   // empty batch: proves URL, key and secret are all good
    ui.alert('Connected. The sheet can reach the system.');
  } catch (e) {
    ui.alert('Connection failed\n\n' + e.message);
  }
}

// ── Sync entry points ─────────────────────────────────────────────

function syncChangedRows() { runSync(false); }
function syncAllRows()     { runSync(true);  }
function pullNow()         { pullChangedShipments(false, null); }

/**
 * Called by the 15-minute trigger. Silent — no dialogs.
 *
 * Push first, pull second. That order is what makes "the system wins"
 * true: an edit made here reaches the server before we ask the server
 * what changed, so the value that comes back down is the one the
 * system settled on.
 */
function autoSync() {
  var pushed = runSync(false, true) || [];
  pullChangedShipments(true, pushed);
}

/** Returns the AWBs it pushed, so the pull can skip them. */
function runSync(forceAll, silent) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Shipments') || ss.getSheets()[0];
  var ui    = silent ? null : SpreadsheetApp.getUi();

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    if (ui) ui.alert('Nothing to sync — the sheet has no data rows.');
    return [];
  }

  var cols = ensureColumns(sheet);
  var missing = REQUIRED_HEADERS.filter(function (h) { return !(h in cols.byHeader); });
  if (missing.length) {
    var msg = 'These required columns are missing or renamed:\n\n' + missing.join('\n');
    if (ui) ui.alert(msg); else Logger.log(msg);
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, cols.width).getValues();
  var tz     = ss.getSpreadsheetTimeZone();

  // Build the payload, skipping blank and unchanged rows
  var payload = [];
  var rowMeta = {};   // row_index → { sheetRow, hash }

  for (var i = 0; i < values.length; i++) {
    var row      = values[i];
    var sheetRow = i + 2;

    if (row.join('').toString().trim() === '') continue;   // blank line

    var record = buildRecord(row, cols, tz);

    // Skip rows that have not changed since their last successful sync
    var hash        = computeHash(record);
    var currentHash = cols.byHeader[HASH_HEADER] !== undefined
      ? String(row[cols.byHeader[HASH_HEADER]]).trim() : '';
    var currentStat = cols.byHeader[STATUS_HEADER] !== undefined
      ? String(row[cols.byHeader[STATUS_HEADER]]).trim() : '';

    if (!forceAll && hash === currentHash && currentStat.indexOf('OK') === 0) continue;

    record.row_index = sheetRow;
    payload.push(record);
    rowMeta[sheetRow] = { sheetRow: sheetRow, hash: hash };
  }

  if (!payload.length) {
    if (ui) ui.alert('Everything is already up to date.');
    return [];
  }

  // Send in batches
  var created = 0, updated = 0, failed = 0;
  var results = [];

  for (var b = 0; b < payload.length; b += BATCH_SIZE) {
    var batch = payload.slice(b, b + BATCH_SIZE);
    var res;
    try {
      res = callSync(batch);
    } catch (e) {
      // Whole batch failed (network, bad secret) — mark every row in it
      res = batch.map(function (r) {
        return { row_index: r.row_index, status: 'error', message: e.message };
      });
    }
    results = results.concat(res);
  }

  // Write results back into the sheet
  var statusCol = cols.byHeader[STATUS_HEADER] + 1;
  var timeCol   = cols.byHeader[TIME_HEADER]   + 1;
  var hashCol   = cols.byHeader[HASH_HEADER]   + 1;
  var stamp     = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  results.forEach(function (r) {
    var meta = rowMeta[r.row_index];
    if (!meta) return;

    if (r.status === 'error') {
      failed++;
      sheet.getRange(meta.sheetRow, statusCol).setValue('ERROR — ' + r.message)
           .setFontColor('#b91c1c');
      sheet.getRange(meta.sheetRow, hashCol).setValue('');   // retry next run
    } else {
      if (r.status === 'created') created++; else updated++;
      sheet.getRange(meta.sheetRow, statusCol)
           .setValue('OK — ' + (r.status === 'created' ? 'created' : 'updated'))
           .setFontColor('#15803d');
      sheet.getRange(meta.sheetRow, hashCol).setValue(meta.hash);
    }
    sheet.getRange(meta.sheetRow, timeCol).setValue(stamp);
  });

  var summary = created + ' created, ' + updated + ' updated'
              + (failed ? ', ' + failed + ' failed — see the Sync Status column' : '');
  if (ui) ui.alert(summary); else Logger.log(summary);

  // The AWBs we just wrote to the server. Every one of them now has a
  // fresh updated_at, so without this list the pull would hand all of
  // them straight back to us on the same cycle.
  return payload
    .map(function (r) { return r.awb_number; })
    .filter(function (a) { return a; })
    .slice(0, MAX_EXCLUDE);
}

// ── Backfill: system → sheet ──────────────────────────────────────

/**
 * Pull every shipment already in the system into this sheet.
 *
 * Imported rows are stamped as already-synced (status + hash), so the
 * next Sync Now or auto-sync run skips them instead of pushing 2,700
 * rows straight back at the server. Edit an imported row and only that
 * row goes back, exactly as if it had been typed here.
 */
function importExistingShipments() {
  var ui    = SpreadsheetApp.getUi();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Shipments') || ss.getSheets()[0];
  var tz    = ss.getSpreadsheetTimeZone();

  var cols    = ensureColumns(sheet);
  var missing = REQUIRED_HEADERS.filter(function (h) { return !(h in cols.byHeader); });
  if (missing.length) {
    ui.alert('These required columns are missing or renamed:\n\n' + missing.join('\n'));
    return;
  }

  // Clearing first keeps AWBs unique in the sheet — importing on top of
  // existing rows would leave two rows claiming the same shipment.
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var answer = ui.alert(
      'Replace ' + (lastRow - 1) + ' existing row' + (lastRow - 1 === 1 ? '' : 's') + '?',
      'Importing clears everything below the header row and replaces it with a fresh '
      + 'copy from the system.\n\nNothing in the system is deleted or changed — this '
      + 'only rewrites the sheet.',
      ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return;
    sheet.getRange(2, 1, lastRow - 1, cols.width).clearContent();
  }

  // Pull every page
  var records = [];
  var total   = 0;
  try {
    while (true) {
      var page = callExport(IMPORT_PAGE_SIZE, records.length);
      total = page.total || 0;
      var batch = page.rows || [];
      if (!batch.length) break;
      records = records.concat(batch);
      if (records.length >= total) break;
    }
  } catch (e) {
    ui.alert('Import failed\n\n' + e.message
             + '\n\n(If this mentions the function not existing, run migration '
             + '008_sheet_backfill.sql in Supabase first.)');
    return;
  }

  if (!records.length) {
    ui.alert('The system has no shipments to import.');
    return;
  }

  // field key → sheet column index, for the columns this sheet actually has
  var width  = cols.width;
  var target = {};
  for (var header in FIELD_MAP) {
    if (cols.byHeader[header] !== undefined) target[FIELD_MAP[header]] = cols.byHeader[header];
  }

  var values = records.map(function (rec) {
    var row = new Array(width);
    for (var i = 0; i < width; i++) row[i] = '';
    for (var key in target) {
      var v = rec[key];
      if (v === null || v === undefined) continue;
      row[target[key]] = (key === 'flight_date') ? toDateValue(v) : v;
    }
    return row;
  });

  // A new sheet is 1,000 rows; the log is bigger than that
  var needed = values.length + 1;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());

  sheet.getRange(2, 1, values.length, width).setValues(values);

  // Real dates, displayed the way the rest of the system writes them
  if (cols.byHeader['Flight Date'] !== undefined) {
    sheet.getRange(2, cols.byHeader['Flight Date'] + 1, values.length, 1)
         .setNumberFormat('yyyy-mm-dd');
  }
  SpreadsheetApp.flush();

  stampAsSynced(sheet, cols, tz, values.length);

  // The sheet now mirrors the system exactly, so the incremental pull
  // should start from here rather than asking how far back to go.
  try {
    PropertiesService.getScriptProperties()
      .setProperty(LAST_PULL_KEY, callPull(null, 1, 0, null).next_since);
  } catch (e) {
    Logger.log('Imported, but could not set the pull watermark: ' + e.message);
  }

  ui.alert('Imported ' + values.length + ' of ' + total + ' shipments.\n\n'
         + 'They are marked as already synced, so nothing is pushed back until you '
         + 'edit a row or add a new one.');
}

/**
 * Mark freshly imported rows as in-sync.
 *
 * The hash is recomputed by READING THE SHEET BACK, not from the payload
 * we just sent — so it goes through the same normalise() path a real sync
 * would use. If those two ever disagreed, every row would push on the next
 * run and this would be pointless.
 */
function stampAsSynced(sheet, cols, tz, count) {
  var rows   = sheet.getRange(2, 1, count, cols.width).getValues();
  var stamp  = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  var status = [], times = [], hashes = [];
  rows.forEach(function (row) {
    status.push(['OK — imported']);
    times.push([stamp]);
    hashes.push([computeHash(buildRecord(row, cols, tz))]);
  });

  sheet.getRange(2, cols.byHeader[STATUS_HEADER] + 1, count, 1)
       .setValues(status).setFontColor('#15803d');
  sheet.getRange(2, cols.byHeader[TIME_HEADER] + 1, count, 1).setValues(times);
  sheet.getRange(2, cols.byHeader[HASH_HEADER] + 1, count, 1).setValues(hashes);
}

// ── Incremental pull: system → sheet ──────────────────────────────

/**
 * Bring down shipments added or edited in the system since last time
 * and merge them into this sheet by AWB.
 *
 * An AWB already here has its row rewritten in place. A new AWB is
 * appended at the bottom. Nothing is ever cleared, and rows the client
 * typed that have not reached the server yet are left alone.
 *
 * Merged rows are stamped with a fresh hash, so the next push sees
 * them as already in sync and does not send them back up.
 *
 * @param silent      true when called from the trigger — no dialogs
 * @param excludeAwbs AWBs pushed earlier in this same run, so the
 *                    server does not hand our own writes back to us
 */
function pullChangedShipments(silent, excludeAwbs) {
  var ui    = silent ? null : SpreadsheetApp.getUi();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Shipments') || ss.getSheets()[0];
  var tz    = ss.getSpreadsheetTimeZone();
  var props = PropertiesService.getScriptProperties();

  var cols    = ensureColumns(sheet);
  var missing = REQUIRED_HEADERS.filter(function (h) { return !(h in cols.byHeader); });
  if (missing.length) {
    var msg = 'These required columns are missing or renamed:\n\n' + missing.join('\n');
    if (ui) ui.alert(msg); else Logger.log(msg);
    return;
  }

  var since = props.getProperty(LAST_PULL_KEY) || '';

  // ── First ever pull: decide where to start from ────────────────
  if (!since) {
    if (silent) {
      // Never let a trigger decide on its own to merge the entire log.
      // Adopt a watermark quietly; from the next cycle it is a normal
      // incremental pull. A full merge stays a deliberate manual act.
      try {
        props.setProperty(LAST_PULL_KEY, callPull(null, 1, 0, null).next_since);
        Logger.log('First auto-pull: watermark set, nothing merged.');
      } catch (e) {
        Logger.log('First auto-pull failed: ' + e.message);
      }
      return;
    }

    var answer = ui.alert(
      'First pull — how far back?',
      'YES  — merge EVERY shipment in the system into this sheet now. '
      + 'Existing rows are matched on AWB and rewritten; unknown AWBs are '
      + 'added at the bottom. Nothing is deleted.\n\n'
      + 'NO  — start from this moment. Only shipments changed in the system '
      + 'from now on come down.',
      ui.ButtonSet.YES_NO_CANCEL);

    if (answer === ui.Button.CANCEL) return;

    if (answer === ui.Button.NO) {
      try {
        props.setProperty(LAST_PULL_KEY, callPull(null, 1, 0, null).next_since);
        ui.alert('Done. From now on, changes made in the system come down here.');
      } catch (e) {
        ui.alert('Could not reach the system\n\n' + e.message);
      }
      return;
    }
    // YES falls through with since = '' → the server returns everything
  }

  // ── Fetch every page of the window ─────────────────────────────
  var records   = [];
  var total     = 0;
  var nextSince = since;

  try {
    while (true) {
      var page = callPull(since || null, IMPORT_PAGE_SIZE, records.length, excludeAwbs);
      total     = page.total || 0;
      nextSince = page.next_since || nextSince;

      var batch = page.rows || [];
      if (!batch.length) break;
      records = records.concat(batch);
      if (records.length >= total) break;
    }
  } catch (e) {
    var err = 'Pull failed\n\n' + e.message
            + '\n\n(If this mentions the function not existing, run migration '
            + '009_sheet_pull_changes.sql in Supabase first.)';
    if (ui) ui.alert(err); else Logger.log(err);
    return;
  }

  if (!records.length) {
    // Still advance — nothing changed, and next time we ask from here.
    if (nextSince) props.setProperty(LAST_PULL_KEY, nextSince);
    if (ui) ui.alert('Nothing new in the system.'); else Logger.log('Pull: nothing new.');
    return;
  }

  // ── Index what the sheet already holds ─────────────────────────
  var width   = cols.width;
  var lastRow = sheet.getLastRow();
  var rows    = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  var awbCol  = cols.byHeader['AWB Number'];

  var byAwb = {};
  for (var i = 0; i < rows.length; i++) {
    var k = awbKey(rows[i][awbCol]);
    // First occurrence wins — if the sheet somehow holds an AWB twice,
    // rewriting only the first keeps the duplicate visible rather than
    // silently making the two rows agree.
    if (k && byAwb[k] === undefined) byAwb[k] = i;
  }

  // field key → sheet column index, for the columns this sheet has
  var target = {};
  for (var header in FIELD_MAP) {
    if (cols.byHeader[header] !== undefined) target[FIELD_MAP[header]] = cols.byHeader[header];
  }

  var stamp     = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  var statusCol = cols.byHeader[STATUS_HEADER];
  var timeCol   = cols.byHeader[TIME_HEADER];
  var hashCol   = cols.byHeader[HASH_HEADER];

  var touched  = [];   // sheet row numbers rewritten in place
  var appended = [];   // brand-new rows, written in one block

  records.forEach(function (rec) {
    var key = awbKey(rec.awb_number);
    if (!key) return;

    var idx = byAwb[key];
    var row;

    if (idx === undefined) {
      row = new Array(width);
      for (var c = 0; c < width; c++) row[c] = '';
    } else {
      row = rows[idx].slice();
    }

    for (var field in target) {
      var v = rec[field];
      if (v === null || v === undefined) continue;
      row[target[field]] = (field === 'flight_date') ? toDateValue(v) : v;
    }

    row[statusCol] = 'OK — from system';
    row[timeCol]   = stamp;
    // Hash the merged row through the same path a push would use, so
    // the next push recognises it as unchanged and skips it.
    row[hashCol]   = computeHash(buildRecord(row, cols, tz));

    if (idx === undefined) {
      appended.push(row);
    } else {
      rows[idx] = row;
      touched.push(idx + 2);
    }
  });

  // ── Write back ─────────────────────────────────────────────────
  // Written as contiguous blocks, not row by row. A full merge touches
  // every row in the sheet, and a few thousand single-row writes would
  // run past the 6-minute execution ceiling; sorted, they collapse
  // into one call.
  touched.sort(function (a, b) { return a - b; });

  for (var t = 0; t < touched.length; ) {
    var start = touched[t];
    var end   = start;
    while (t + 1 < touched.length && touched[t + 1] === end + 1) { t++; end++; }
    t++;

    var block = [];
    for (var r = start; r <= end; r++) block.push(rows[r - 2]);

    sheet.getRange(start, 1, block.length, width).setValues(block);
    sheet.getRange(start, statusCol + 1, block.length, 1).setFontColor('#15803d');
  }

  if (appended.length) {
    var startRow = Math.max(lastRow + 1, 2);
    var needed   = startRow + appended.length - 1;
    if (sheet.getMaxRows() < needed) {
      sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    }

    sheet.getRange(startRow, 1, appended.length, width).setValues(appended);
    sheet.getRange(startRow, statusCol + 1, appended.length, 1).setFontColor('#15803d');

    if (cols.byHeader['Flight Date'] !== undefined) {
      sheet.getRange(startRow, cols.byHeader['Flight Date'] + 1, appended.length, 1)
           .setNumberFormat('yyyy-mm-dd');
    }
  }

  SpreadsheetApp.flush();
  if (nextSince) props.setProperty(LAST_PULL_KEY, nextSince);

  var summary = appended.length + ' new shipment' + (appended.length === 1 ? '' : 's')
              + ' added, ' + touched.length + ' updated from the system.';
  if (ui) ui.alert(summary); else Logger.log(summary);
}

/** Forget the watermark — the next pull starts over. */
function resetPullWatermark() {
  PropertiesService.getScriptProperties().deleteProperty(LAST_PULL_KEY);
  SpreadsheetApp.getUi().alert(
    'Done. The next "Pull updates from system" will ask how far back to go.');
}

// ── Supabase calls ────────────────────────────────────────────────

function callPull(since, limit, offset, excludeAwbs) {
  var props  = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var key    = props.getProperty('SUPABASE_KEY');
  var secret = props.getProperty('SYNC_SECRET');

  if (!url || !key || !secret) {
    throw new Error('Not configured yet. Run TIL Sync ▸ Setup first.');
  }

  var response = UrlFetchApp.fetch(url + '/rest/v1/rpc/export_shipments_changed_since', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      p_secret:       secret,
      p_since:        since || null,
      p_limit:        limit,
      p_offset:       offset,
      p_exclude_awbs: (excludeAwbs && excludeAwbs.length) ? excludeAwbs : null,
    }),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    var detail = body;
    try { detail = JSON.parse(body).message || body; } catch (e) {}
    throw new Error('Server returned ' + code + ': ' + detail);
  }

  return JSON.parse(body) || { total: 0, rows: [] };
}

function callExport(limit, offset) {
  var props  = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var key    = props.getProperty('SUPABASE_KEY');
  var secret = props.getProperty('SYNC_SECRET');

  if (!url || !key || !secret) {
    throw new Error('Not configured yet. Run TIL Sync ▸ Setup first.');
  }

  var response = UrlFetchApp.fetch(url + '/rest/v1/rpc/export_shipments_to_sheet', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p_secret: secret, p_limit: limit, p_offset: offset }),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    var detail = body;
    try { detail = JSON.parse(body).message || body; } catch (e) {}
    throw new Error('Server returned ' + code + ': ' + detail);
  }

  return JSON.parse(body) || { total: 0, rows: [] };
}

function callSync(rows) {
  var props  = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var key    = props.getProperty('SUPABASE_KEY');
  var secret = props.getProperty('SYNC_SECRET');

  if (!url || !key || !secret) {
    throw new Error('Not configured yet. Run TIL Sync ▸ Setup first.');
  }

  var response = UrlFetchApp.fetch(url + '/rest/v1/rpc/sync_shipments_from_sheet', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p_secret: secret, p_rows: rows }),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    var detail = body;
    try { detail = JSON.parse(body).message || body; } catch (e) {}
    throw new Error('Server returned ' + code + ': ' + detail);
  }

  return JSON.parse(body) || [];
}

// ── Helpers ───────────────────────────────────────────────────────

/** Index the header row, adding the three script-owned columns if absent. */
function ensureColumns(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  function indexOf() {
    var map = {};
    headers.forEach(function (h, i) {
      var name = String(h).trim();
      if (name) map[name] = i;
    });
    return map;
  }

  var byHeader = indexOf();

  // Track the next free column locally — getLastColumn() does not reliably
  // refresh between writes in the same execution.
  var nextCol = headers.length + 1;

  [STATUS_HEADER, TIME_HEADER, HASH_HEADER].forEach(function (h) {
    if (byHeader[h] === undefined) {
      sheet.getRange(1, nextCol).setValue(h).setFontWeight('bold');
      byHeader[h] = nextCol - 1;
      headers.push(h);
      nextCol++;
    }
  });
  SpreadsheetApp.flush();

  // Keep the hash out of the client's way
  sheet.hideColumns(byHeader[HASH_HEADER] + 1);

  return { byHeader: byHeader, width: headers.length };
}

/** One sheet row → the record the database function expects. */
function buildRecord(row, cols, tz) {
  var record = {};
  for (var header in FIELD_MAP) {
    var c = cols.byHeader[header];
    if (c === undefined) continue;
    record[FIELD_MAP[header]] = normalise(row[c], header, tz);
  }
  return record;
}

/**
 * 'YYYY-MM-DD' from the server → a real Date, so the cell is a date not text.
 *
 * Built at midday, not midnight: the Date is constructed in the script's
 * timezone but read back in the spreadsheet's, and if those two differ the
 * day would roll backwards or forwards.
 */
function toDateValue(iso) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
}

/** Sheet cell → plain string the database function can parse. */
function normalise(value, header, tz) {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }

  var s = String(value).trim();

  if (header === 'Flight Date') return toIsoDate(s);

  return s;
}

/**
 * Normalise a date typed as TEXT into YYYY-MM-DD.
 *
 * Day-first (27/07/2026 = 27 July) to match how dates are written in
 * Pakistan and how the Add Shipment form displays them. Formatting the
 * column as a real Date in Sheets avoids this guess entirely — see SETUP.md.
 */
function toIsoDate(s) {
  if (!s) return '';

  // Already ISO
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    var iso = s.split('-');
    return iso[0] + '-' + pad2(iso[1]) + '-' + pad2(iso[2]);
  }

  // 27/07/2026 · 27-07-2026 · 27.07.2026  → day first
  var dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    var d = parseInt(dmy[1], 10), m = parseInt(dmy[2], 10);
    // If the first number can't be a day but the second can, it was month-first
    if (d > 12 && m <= 12)      return dmy[3] + '-' + pad2(m) + '-' + pad2(d);
    if (m > 12 && d <= 12)      return dmy[3] + '-' + pad2(d) + '-' + pad2(m);
    return dmy[3] + '-' + pad2(m) + '-' + pad2(d);   // ambiguous → day first
  }

  // 27-Jul-2026 · 27 July 2026
  var named = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})$/);
  if (named) {
    var months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                   jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    var mm = months[named[2].slice(0, 3).toLowerCase()];
    if (mm) return named[3] + '-' + pad2(mm) + '-' + pad2(named[1]);
  }

  return s;   // unrecognised — let the server report it
}

function pad2(n) { return ('0' + n).slice(-2); }

/** AWBs are compared case- and whitespace-insensitively when matching rows. */
function awbKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase();
}

/** Stable fingerprint of a row's data, so unchanged rows are skipped. */
function computeHash(record) {
  var keys = Object.keys(record).sort();
  var flat = keys.map(function (k) { return k + '=' + record[k]; }).join('|');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, flat);
  return bytes.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

// ── Triggers ──────────────────────────────────────────────────────

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('autoSync').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert(
    'Auto-sync is on. Every 15 minutes this sheet pushes what you have typed, '
    + 'then brings down anything added or changed in the system.');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoSync') ScriptApp.deleteTrigger(t);
  });
}
