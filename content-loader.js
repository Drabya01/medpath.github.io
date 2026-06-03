/**
 * MedPath Content Loader  v1.0
 * ════════════════════════════════════════════════════════════════
 *
 * Lets teachers and contributors add cases, flashcards, and quiz
 * questions via a Google Sheet — no code edits, no redeployment.
 *
 * ════════════════════════════════════════════════════════════════
 *  QUICK START
 * ════════════════════════════════════════════════════════════════
 *
 *  1. Go to https://docs.google.com/spreadsheets/create
 *  2. Rename the three tabs to exactly:  Cases   Flashcards   Quiz
 *     (capitalisation matters)
 *  3. Add column headers in Row 1 of each tab (see layouts below).
 *     Row 2 onwards = your content.
 *  4. Share → Anyone with the link → Viewer
 *  5. Copy the Sheet ID from the URL:
 *       https://docs.google.com/spreadsheets/d/ ← THIS → /edit
 *  6. Paste the ID in the app:  Settings → Content → Sheet ID → Save
 *     — OR — hard-code it in FALLBACK_SHEET_ID below for a deploy default.
 *
 * ════════════════════════════════════════════════════════════════
 *  COLUMN LAYOUTS
 * ════════════════════════════════════════════════════════════════
 *
 *  Cases tab
 *  ─────────
 *  id | icon | title | difficulty | tag | patient | complaint |
 *  background | scenario | choice_a | choice_b | choice_c | choice_d |
 *  correct | explanation | learnmore
 *
 *  • id          Unique slug, no spaces:  septic_shock
 *  • icon        One emoji (optional, defaults to 🩺)
 *  • difficulty  beginner · intermediate · advanced · expert
 *  • correct     Letter of correct answer: A, B, C, or D
 *  • learnmore   Key terms string, e.g.: SIRS · Vasopressors · Lactate
 *
 *  Flashcards tab
 *  ──────────────
 *  cat | term | def
 *
 *  • cat   Category, e.g.: Cardiology  or  Prefixes
 *  • term  Front of card (the question / term)
 *  • def   Back of card (the definition / answer)
 *
 *  Quiz tab
 *  ────────
 *  q | choice_a | choice_b | choice_c | choice_d | correct | explanation
 *
 *  • correct  0-indexed position of correct answer (0=A, 1=B, 2=C, 3=D)
 *
 * ════════════════════════════════════════════════════════════════
 *  HOW IT WORKS
 * ════════════════════════════════════════════════════════════════
 *
 *  On startup MedPathContent.load() is awaited in init():
 *    • If a sheet is configured and fresh data is cached → apply cache,
 *      then silently re-fetch in the background (stale-while-revalidate).
 *    • If configured but no cache → fetch first, wait max 8 s, then
 *      continue (so offline / slow network never blocks startup).
 *    • If not configured → skip entirely; built-in content is used.
 *
 *  Merge mode (MERGE_MODE = 'extend', default):
 *    Sheet rows are ADDED to the built-in content.
 *    Conflicts are resolved in favour of the sheet
 *    (same case id, or same flashcard cat+term).
 *
 *  Merge mode 'replace':
 *    Sheet rows REPLACE the built-in arrays for any tab that has
 *    at least one valid row.  Use once you've moved everything to
 *    the sheet and no longer want the hard-coded fallback.
 */

'use strict';

var MedPathContent = (function () {

  // ═══════════════════════════════════════════════════════════════
  //  CONFIGURATION  — edit these if needed
  // ═══════════════════════════════════════════════════════════════

  /**
   * Default Sheet ID used before the user sets one in Settings.
   * Leave blank to require manual entry.
   * Example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
   */
  var FALLBACK_SHEET_ID = '';

  /** How long cached content stays fresh before a background re-fetch. */
  var CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * 'extend'  Sheet rows are added on top of built-in content.
   *           Conflicts (same id / cat+term) are won by the sheet.
   * 'replace' Sheet rows replace built-in arrays (per tab).
   *           Use once all content lives in the sheet.
   */
  var MERGE_MODE = 'extend';

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  var STORAGE_CACHE_KEY  = 'medpath_content_v1';
  var STORAGE_SHEET_KEY  = 'medpath_sheet_id';
  var STORAGE_STATUS_KEY = 'medpath_content_status';
  var GVIZ_BASE          = 'https://docs.google.com/spreadsheets/d';
  var FETCH_TIMEOUT_MS   = 8000;

  // ═══════════════════════════════════════════════════════════════
  //  STATUS  (persisted across page loads so Settings shows last-known state)
  // ═══════════════════════════════════════════════════════════════

  var _status = {
    state:    'idle',   // idle | loading | ok | error | unconfigured
    lastSync: null,     // ISO timestamp of last successful fetch
    error:    null,     // human-readable error message
    counts:   { cases: 0, flashcards: 0, quiz: 0 }
  };

  function _persistStatus() {
    try { localStorage.setItem(STORAGE_STATUS_KEY, JSON.stringify(_status)); } catch (_) {}
  }

  function _restoreStatus() {
    try {
      var raw = localStorage.getItem(STORAGE_STATUS_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        _status = Object.assign({}, _status, saved);
      }
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  SHEET ID RESOLUTION  (stored value overrides hard-coded default)
  // ═══════════════════════════════════════════════════════════════

  function _resolveSheetId() {
    try {
      var stored = localStorage.getItem(STORAGE_SHEET_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
    return FALLBACK_SHEET_ID.trim() || null;
  }

  /**
   * Set a new Sheet ID.  Accepts either a bare ID or a full URL.
   * Returns the normalised ID that was saved.
   */
  function setSheetId(raw) {
    var id = (raw || '').trim();
    // Accept full URLs: extract the ID segment
    var m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) id = m[1];
    try {
      if (id) localStorage.setItem(STORAGE_SHEET_KEY, id);
      else    localStorage.removeItem(STORAGE_SHEET_KEY);
    } catch (_) {}
    return id;
  }

  // ═══════════════════════════════════════════════════════════════
  //  NETWORK: fetch one sheet tab via the Google Visualization API
  //  (public sheets only — no API key needed)
  // ═══════════════════════════════════════════════════════════════

  function _fetchSheet(sheetId, tabName) {
    var url = GVIZ_BASE + '/' + sheetId +
              '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(tabName) +
              '&_=' + Date.now();

    return new Promise(function (resolve, reject) {
      var done = false;
      var tid = setTimeout(function () {
        if (!done) { done = true; reject(new Error('Timeout fetching "' + tabName + '" tab')); }
      }, FETCH_TIMEOUT_MS);

      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching "' + tabName + '" tab');
          return res.text();
        })
        .then(function (text) {
          clearTimeout(tid);
          if (done) return;
          done = true;

          // Strip the JSONP security wrapper:
          //   /*O_o*/\ngoogle.visualization.Query.setResponse({...});
          var match = text.match(/google\.visualization\.Query\.setResponse\((\{[\s\S]*\})\)\s*;?\s*$/);
          if (!match) {
            reject(new Error('Unexpected response format for "' + tabName + '" tab'));
            return;
          }

          var data;
          try { data = JSON.parse(match[1]); }
          catch (e) { reject(new Error('JSON parse error for "' + tabName + '" tab: ' + e.message)); return; }

          if (data.status !== 'ok') {
            var msg = (data.errors && data.errors[0])
              ? (data.errors[0].detailed_message || data.errors[0].message)
              : 'Unknown API error';
            reject(new Error('"' + tabName + '" tab error: ' + msg));
            return;
          }

          resolve(_parseGvizTable(data.table));
        })
        .catch(function (err) {
          clearTimeout(tid);
          if (!done) { done = true; reject(err); }
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PARSING: gviz table object → array of plain row objects
  // ═══════════════════════════════════════════════════════════════

  function _parseGvizTable(table) {
    if (!table || !table.cols || !table.rows) return [];

    // Build normalised header keys from column labels
    var headers = table.cols.map(function (col) {
      return (col.label || col.id || '').trim().toLowerCase().replace(/\s+/g, '_');
    });

    var rows = [];
    for (var ri = 0; ri < table.rows.length; ri++) {
      var row = table.rows[ri];
      if (!row || !row.c) continue;
      var obj = {};
      for (var ci = 0; ci < row.c.length; ci++) {
        var key  = headers[ci];
        var cell = row.c[ci];
        if (!key) continue;
        // cell is null (empty) or { v: rawValue, f: formattedValue }
        obj[key] = (cell !== null && cell !== undefined && cell.v !== null && cell.v !== undefined)
          ? String(cell.v).trim()
          : '';
      }
      // Skip completely blank rows
      if (Object.keys(obj).every(function (k) { return obj[k] === ''; })) continue;
      rows.push(obj);
    }
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ROW VALIDATORS / PARSERS  →  typed content objects
  // ═══════════════════════════════════════════════════════════════

  var _VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];
  var _VALID_LETTERS      = ['A', 'B', 'C', 'D'];

  function _parseCase(row) {
    if (!row.id || !row.title) return null;

    var difficulty = (row.difficulty || '').toLowerCase().trim();
    if (_VALID_DIFFICULTIES.indexOf(difficulty) === -1) return null;

    var correctLetter = (row.correct || '').toUpperCase().trim();
    if (_VALID_LETTERS.indexOf(correctLetter) === -1) return null;

    var choices = _VALID_LETTERS
      .map(function (L) { return { text: row['choice_' + L.toLowerCase()] || '', letter: L }; })
      .filter(function (ch) { return ch.text.trim() !== ''; })
      .map(function (ch) { return { text: ch.text, correct: ch.letter === correctLetter }; });

    if (choices.length < 2) return null;  // malformed row — skip silently

    return {
      id:          row.id.trim().replace(/\s+/g, '_').toLowerCase(),
      icon:        row.icon  || '🩺',
      title:       row.title,
      difficulty:  difficulty,
      tag:         row.tag        || '',
      patient:     row.patient    || '',
      complaint:   row.complaint  || '',
      background:  row.background || '',
      scenario:    row.scenario   || '',
      choices:     choices,
      explanation: row.explanation || '',
      learnMore:   row.learnmore  || row.learn_more || ''
    };
  }

  function _parseFlashcard(row) {
    var cat  = (row.cat  || row.category || '').trim();
    var term = (row.term || row.front    || '').trim();
    var def  = (row.def  || row.definition || row.back || '').trim();
    if (!cat || !term || !def) return null;
    return { cat: cat, term: term, def: def };
  }

  function _parseQuiz(row) {
    var q = (row.q || row.question || '').trim();
    if (!q) return null;

    var choices = ['choice_a', 'choice_b', 'choice_c', 'choice_d']
      .map(function (k) { return (row[k] || '').trim(); })
      .filter(function (v) { return v !== ''; });

    if (choices.length < 2) return null;

    var correct = parseInt(row.correct || row.correct_index || '0', 10);
    if (isNaN(correct) || correct < 0 || correct >= choices.length) return null;

    return {
      q:           q,
      choices:     choices,
      correct:     correct,
      explanation: (row.explanation || '').trim()
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  MERGE  (external + built-in → unified arrays)
  // ═══════════════════════════════════════════════════════════════

  function _mergeCases(builtin, external) {
    if (!external.length) return builtin;
    if (MERGE_MODE === 'replace') return external;
    // Extend: build a map by ID; sheet wins on collision
    var byId = {};
    builtin.forEach(function (c)  { byId[c.id] = c; });
    external.forEach(function (c) { byId[c.id] = c; });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function _mergeFlashcards(builtin, external) {
    if (!external.length) return builtin;
    if (MERGE_MODE === 'replace') return external;
    // Extend: deduplicate by cat+term; sheet wins
    var seen = {};
    builtin.forEach(function (f) { seen[f.cat + '\u0000' + f.term] = true; });
    var newCards = external.filter(function (f) {
      return !seen[f.cat + '\u0000' + f.term];
    });
    return builtin.concat(newCards);
  }

  function _mergeQuiz(builtin, external) {
    if (!external.length) return builtin;
    if (MERGE_MODE === 'replace') return external;
    // Extend: deduplicate by question text
    var seen = {};
    builtin.forEach(function (q) { seen[q.q] = true; });
    var newQs = external.filter(function (q) { return !seen[q.q]; });
    return builtin.concat(newQs);
  }

  // ═══════════════════════════════════════════════════════════════
  //  CACHE  (localStorage, invalidated by TTL)
  // ═══════════════════════════════════════════════════════════════

  function _getCached() {
    try {
      var raw = localStorage.getItem(STORAGE_CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.timestamp || !obj.data) return null;
      if (Date.now() - obj.timestamp > CACHE_TTL_MS) return null;  // expired
      return obj.data;
    } catch (_) { return null; }
  }

  function _setCache(data) {
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data }));
    } catch (_) { /* quota exceeded — not fatal */ }
  }

  function clearCache() {
    try { localStorage.removeItem(STORAGE_CACHE_KEY); } catch (_) {}
    _status.state  = _resolveSheetId() ? 'idle' : 'unconfigured';
    _status.counts = { cases: 0, flashcards: 0, quiz: 0 };
    _persistStatus();
  }

  // ═══════════════════════════════════════════════════════════════
  //  APPLY  →  push data into the live window.* arrays
  // ═══════════════════════════════════════════════════════════════

  function _applyData(data) {
    if (data.cases.length)
      window.cases = _mergeCases(window.cases || [], data.cases);

    if (data.flashcards.length)
      window.flashcards = _mergeFlashcards(window.flashcards || [], data.flashcards);

    if (data.quiz.length)
      window.allQuestions = _mergeQuiz(window.allQuestions || [], data.quiz);

    _status.counts   = { cases: data.cases.length, flashcards: data.flashcards.length, quiz: data.quiz.length };
    _status.state    = 'ok';
    _status.lastSync = new Date().toISOString();
    _status.error    = null;
    _persistStatus();
  }

  // ═══════════════════════════════════════════════════════════════
  //  FETCH + PARSE + APPLY  (one full network roundtrip)
  // ═══════════════════════════════════════════════════════════════

  function _fetchAndApply(sheetId) {
    return Promise.all([
      _fetchSheet(sheetId, 'Cases')
        .catch(function (e) { console.warn('[MedPath Content] Cases tab:', e.message); return []; }),
      _fetchSheet(sheetId, 'Flashcards')
        .catch(function (e) { console.warn('[MedPath Content] Flashcards tab:', e.message); return []; }),
      _fetchSheet(sheetId, 'Quiz')
        .catch(function (e) { console.warn('[MedPath Content] Quiz tab:', e.message); return []; })
    ])
    .then(function (results) {
      var rawCases      = results[0];
      var rawFlashcards = results[1];
      var rawQuiz       = results[2];

      if (!rawCases.length && !rawFlashcards.length && !rawQuiz.length) {
        throw new Error(
          'All tabs returned empty. Confirm the sheet is shared publicly and ' +
          'tab names are exactly: Cases, Flashcards, Quiz'
        );
      }

      var data = {
        cases:      rawCases.map(_parseCase).filter(Boolean),
        flashcards: rawFlashcards.map(_parseFlashcard).filter(Boolean),
        quiz:       rawQuiz.map(_parseQuiz).filter(Boolean)
      };

      _setCache(data);
      _applyData(data);
      return data;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * load(onBgRefresh?)
   *
   * Called once during app init (await-ed in init()).
   * Strategy:
   *   • Not configured  → return immediately.
   *   • Cache fresh      → apply cache, re-fetch in background.
   *   • No cache         → fetch and wait (max FETCH_TIMEOUT_MS).
   *
   * onBgRefresh is called after a background re-fetch succeeds —
   * use it to rebuild derived state (allCategories, diff counts, etc.)
   */
  function load(onBgRefresh) {
    _restoreStatus();

    var sheetId = _resolveSheetId();
    if (!sheetId) {
      _status.state = 'unconfigured';
      _persistStatus();
      return Promise.resolve();
    }

    _status.state = 'loading';

    var cached = _getCached();
    if (cached) {
      // Serve immediately from cache
      _applyData(cached);

      // Re-fetch in background — don't await, never block init
      _fetchAndApply(sheetId)
        .then(function () {
          if (typeof onBgRefresh === 'function') {
            try { onBgRefresh(); } catch (_) {}
          }
        })
        .catch(function (err) {
          console.warn('[MedPath Content] Background refresh failed:', err.message);
          // Status is still 'ok' — cached data is still live
          _status.state = 'ok';
          _persistStatus();
        });

      return Promise.resolve();
    }

    // No cache — fetch before init continues, but cap at FETCH_TIMEOUT_MS
    return Promise.race([
      _fetchAndApply(sheetId),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Startup timeout — continuing offline')); }, FETCH_TIMEOUT_MS);
      })
    ])
    .catch(function (err) {
      console.warn('[MedPath Content] Startup load failed:', err.message);
      _status.state = 'error';
      _status.error = err.message;
      _persistStatus();
      // App continues with built-in content; no data is lost
    });
  }

  /**
   * refresh()
   *
   * Force a fresh network fetch, bypassing cache.
   * Called by the "Sync Now" button in Settings.
   * Returns a Promise<{ ok: bool, counts?, error? }>.
   */
  function refresh() {
    var sheetId = _resolveSheetId();
    if (!sheetId) {
      return Promise.resolve({
        ok: false,
        error: 'No Sheet ID configured. Paste one in Settings → Content.'
      });
    }

    _status.state = 'loading';
    _persistStatus();

    return _fetchAndApply(sheetId)
      .then(function (data) {
        return { ok: true, counts: _status.counts };
      })
      .catch(function (err) {
        _status.state = 'error';
        _status.error = err.message;
        _persistStatus();
        return { ok: false, error: err.message };
      });
  }

  /** Returns a copy of the current sync status object. */
  function getStatus() {
    return Object.assign({}, _status, { counts: Object.assign({}, _status.counts) });
  }

  return {
    load:       load,
    refresh:    refresh,
    getStatus:  getStatus,
    setSheetId: setSheetId,
    clearCache: clearCache
  };

})();
