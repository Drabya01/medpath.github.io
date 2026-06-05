/**
 * MedPath Supabase Sync  v1.0
 * ════════════════════════════════════════════════════════════════
 *
 * Syncs all student progress to Supabase so it survives device
 * switches and browser clears. Offline-first: localStorage always
 * updates instantly; Supabase syncs silently in the background.
 *
 * ════════════════════════════════════════════════════════════════
 *  SETUP (do this once)
 * ════════════════════════════════════════════════════════════════
 *
 *  1. Create a Supabase project at https://supabase.com (free tier)
 *
 *  2. Run schema.sql in the SQL Editor
 *     (your project → SQL Editor → New query → paste → Run)
 *
 *  3. Enable Google as an auth provider:
 *     Authentication → Providers → Google → Enable
 *     • Client ID:     paste your GOOGLE_CLIENT_ID from script.js
 *     • Client Secret: leave blank (not needed for this flow)
 *     • Save
 *
 *  4. Fill in the two constants below:
 *     Project URL  →  Settings → API → Project URL
 *     Anon key     →  Settings → API → Project API keys → anon public
 *
 *  5. That's it. Push to GitHub and test.
 */

'use strict';

var SupabaseSync = (function () {

  // ════════════════════════════════════════════════════════════════
  //  CONFIGURATION  ← fill these in
  // ════════════════════════════════════════════════════════════════

  var SUPABASE_URL      = 'https://qtpbalxzbkrbycpqjkzy.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0cGJhbHh6YmtyYnljcHFqa3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MjE1OTYsImV4cCI6MjA5NjA5NzU5Nn0.k1dMjt3d6D57yGKhdUgjIzkWI648qp5O_DswWv92cKo';

  // How long to wait after a save before pushing to Supabase.
  // Prevents a network call on every single keypress / card flip.
  var DEBOUNCE_MS = 3000;

  // ════════════════════════════════════════════════════════════════
  //  INTERNALS
  // ════════════════════════════════════════════════════════════════

  var _db     = null;   // Supabase client instance
  var _uid    = null;   // Supabase user UUID (set after sign-in)
  var _ready  = false;  // true once init() succeeds
  var _timers = {};     // debounce timer per data-type key

  // ════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════

  /**
   * Called once in script.js's init().
   * Creates the Supabase client and subscribes to auth state changes.
   */
  function init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.info(
        '[MedPath Sync] Not configured — ' +
        'set SUPABASE_URL and SUPABASE_ANON_KEY in supabase-sync.js'
      );
      return;
    }

    if (typeof window.supabase === 'undefined') {
      console.warn(
        '[MedPath Sync] Supabase JS library not found. ' +
        'Make sure the CDN <script> tag is in index.html before supabase-sync.js'
      );
      return;
    }

    try {
      _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      _ready = true;

      // Keep _uid in sync if the session refreshes in the background
      _db.auth.onAuthStateChange(function (event, session) {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
          _uid = session.user.id;
        } else if (event === 'SIGNED_OUT') {
          _uid = null;
        }
      });

      // Restore session if the user was already signed in on this device
      _db.auth.getSession().then(function (result) {
        if (result.data && result.data.session) {
          _uid = result.data.session.user.id;
        }
      });

    } catch (err) {
      console.warn('[MedPath Sync] init error:', err.message);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  AUTH HOOKS  (called from script.js)
  // ════════════════════════════════════════════════════════════════

  /**
   * Called immediately after Google Identity Services returns a credential.
   * Exchanges the Google JWT for a Supabase session, then pulls + merges
   * cloud data with whatever is already in localStorage.
   *
   * @param {string} googleIdToken  The raw JWT from response.credential
   */
  async function onGoogleSignIn(googleIdToken) {
    if (!_ready) return;
    try {
      var result = await _db.auth.signInWithIdToken({
        provider: 'google',
        token:    googleIdToken
      });
      if (result.error) throw result.error;
      _uid = result.data.user.id;
      // Pull cloud data and merge — never blocks the UI (runs in background)
      _pullAndMerge().catch(function (err) {
        console.warn('[MedPath Sync] Pull error:', err.message);
      });
    } catch (err) {
      console.warn('[MedPath Sync] Sign-in error:', err.message);
      // Auth failure is non-fatal — app still works offline
    }
  }

  /**
   * Called when the user clicks Sign Out.
   * Pushes any pending local changes first, then ends the Supabase session.
   */
  async function onSignOut() {
    if (!_ready) return;
    try {
      if (_uid) await _pushAll(); // flush before signing out
      await _db.auth.signOut();
    } catch (err) {
      console.warn('[MedPath Sync] Sign-out error:', err.message);
    }
    _uid = null;
  }

  // ════════════════════════════════════════════════════════════════
  //  PULL & MERGE  (cloud → local, on sign-in)
  // ════════════════════════════════════════════════════════════════

  async function _pullAndMerge() {
    if (!_uid) return;

    // Fetch all four tables in parallel
    var responses = await Promise.all([
      _db.from('user_progress')    .select('*').eq('user_id', _uid).maybeSingle(),
      _db.from('user_srs')         .select('*').eq('user_id', _uid).maybeSingle(),
      _db.from('user_settings')    .select('*').eq('user_id', _uid).maybeSingle(),
      _db.from('user_custom_cards').select('*').eq('user_id', _uid).maybeSingle()
    ]);

    var prog  = responses[0].data;
    var srs   = responses[1].data;
    var sets  = responses[2].data;
    var cards = responses[3].data;

    // New user — nothing in the cloud yet.  Push local data up and done.
    if (!prog && !srs && !sets && !cards) {
      await _pushAll();
      return;
    }

    // Merge each data type into localStorage (and into live JS variables)
    if (prog)  _mergeProgress(prog);
    if (srs)   _mergeSRS(srs);
    if (sets)  _mergeSettings(sets);
    if (cards) _mergeCustomCards(cards);

    // Push the merged result back so cloud and local are identical
    await _pushAll();

    // Refresh any visible UI that depends on synced data
    _refreshUI();
  }

  // ── Progress merge ───────────────────────────────────────────

  function _mergeProgress(cloud) {

    // XP — take the maximum of every counter (XP can never go backwards)
    var lxp = _read('medpath_xp', {});
    var cxp = cloud.xp || {};
    var mxp = {
      totalXP:            Math.max(_n(lxp.totalXP),            _n(cxp.totalXP)),
      level:              Math.max(_n(lxp.level, 1),           _n(cxp.level, 1)),
      cardsReviewed:      Math.max(_n(lxp.cardsReviewed),      _n(cxp.cardsReviewed)),
      casesCompleted:     Math.max(_n(lxp.casesCompleted),     _n(cxp.casesCompleted)),
      quizzesDone:        Math.max(_n(lxp.quizzesDone),        _n(cxp.quizzesDone)),
      hosaPanelsOpened:   _union(lxp.hosaPanelsOpened,  cxp.hosaPanelsOpened),
      sectionsVisited:    _union(lxp.sectionsVisited,   cxp.sectionsVisited),
      // Session counters are volatile — always keep local
      consecutiveGoodEasy: _n(lxp.consecutiveGoodEasy),
      sessionCards:        _n(lxp.sessionCards),
      sessionStart:        _n(lxp.sessionStart)
    };
    _write('medpath_xp', mxp);
    if (typeof xpData !== 'undefined') Object.assign(xpData, mxp);

    // Streak — take the higher currentStreak; always keep the later lastVisit
    var lsk = _read('medpath_streak', {});
    var csk = cloud.streak || {};
    var msk = {
      lastVisit:     _laterDate(lsk.lastVisit, csk.lastVisit),
      currentStreak: Math.max(_n(lsk.currentStreak), _n(csk.currentStreak)),
      longestStreak: Math.max(_n(lsk.longestStreak), _n(csk.longestStreak))
    };
    _write('medpath_streak', msk);
    if (typeof progressStreak !== 'undefined') Object.assign(progressStreak, msk);

    // Case stats — per-entity max (avoids double-counting on two devices)
    var lcs = _read('medpath_case_stats', { byId:{}, byTag:{}, byDiff:{} });
    var ccs = cloud.case_stats || {};
    var mcs = { byId:{}, byTag:{}, byDiff:{} };

    var allIds = Object.keys(Object.assign({}, lcs.byId || {}, ccs.byId || {}));
    allIds.forEach(function (id) {
      var l = (lcs.byId||{})[id] || {attempts:0,correct:0};
      var c = (ccs.byId||{})[id] || {attempts:0,correct:0};
      mcs.byId[id] = {
        attempts:   Math.max(_n(l.attempts), _n(c.attempts)),
        correct:    Math.max(_n(l.correct),  _n(c.correct)),
        tag:        l.tag        || c.tag        || '',
        difficulty: l.difficulty || c.difficulty || ''
      };
    });
    ['byTag','byDiff'].forEach(function (key) {
      var all = Object.keys(Object.assign({}, lcs[key]||{}, ccs[key]||{}));
      all.forEach(function (k) {
        var l = (lcs[key]||{})[k] || {attempts:0,correct:0};
        var c = (ccs[key]||{})[k] || {attempts:0,correct:0};
        mcs[key][k] = {
          attempts: Math.max(_n(l.attempts), _n(c.attempts)),
          correct:  Math.max(_n(l.correct),  _n(c.correct))
        };
      });
    });
    _write('medpath_case_stats', mcs);
    if (typeof progressCaseStats !== 'undefined') {
      progressCaseStats.byId  = mcs.byId;
      progressCaseStats.byTag  = mcs.byTag;
      progressCaseStats.byDiff = mcs.byDiff;
    }

    // Quiz stats — field-by-field max
    var lqs = _read('medpath_quiz_stats', {});
    var cqs = cloud.quiz_stats || {};
    var mqs = {
      quizzesDone:  Math.max(_n(lqs.quizzesDone),  _n(cqs.quizzesDone)),
      totalQ:       Math.max(_n(lqs.totalQ),        _n(cqs.totalQ)),
      totalCorrect: Math.max(_n(lqs.totalCorrect),  _n(cqs.totalCorrect)),
      bestScore:    Math.max(_n(lqs.bestScore),     _n(cqs.bestScore))
    };
    _write('medpath_quiz_stats', mqs);
    if (typeof progressQuizStats !== 'undefined') Object.assign(progressQuizStats, mqs);

    // Study log — per-day max (not additive; same session on two devices shouldn't double)
    var lsl = _read('medpath_study_log', {});
    var csl = cloud.study_log || {};
    var msl = Object.assign({}, lsl);
    Object.keys(csl).forEach(function (date) {
      var l = msl[date] || {pts:0,cards:0,cases:0,quizzes:0};
      var c = csl[date];
      msl[date] = {
        pts:     Math.max(_n(l.pts),     _n(c.pts)),
        cards:   Math.max(_n(l.cards),   _n(c.cards)),
        cases:   Math.max(_n(l.cases),   _n(c.cases)),
        quizzes: Math.max(_n(l.quizzes), _n(c.quizzes))
      };
    });
    _write('medpath_study_log', msl);
    if (typeof studyLog !== 'undefined') Object.assign(studyLog, msl);

    // Achievements — union; never lose an unlocked badge
    var lach = _read('medpath_achievements', []);
    var cach = cloud.achievements || [];
    var mach = Array.from(new Set(lach.concat(cach)));
    _write('medpath_achievements', mach);
    if (typeof achUnlocked !== 'undefined') {
      mach.forEach(function (id) { achUnlocked.add(id); });
    }
  }

  // ── SRS + saved cards merge ──────────────────────────────────

  function _mergeSRS(cloud) {
    var local = _read('medpath_sm2', {});
    var cm    = cloud.sm2 || {};
    var merged = Object.assign({}, local);

    // For each card in the cloud: take whichever state shows more study
    // (more reps = more studied). Tie-break on later due date.
    Object.keys(cm).forEach(function (id) {
      var l = local[id];
      var c = cm[id];
      if (!l) { merged[id] = c; return; }
      var cReps = _n(c.reps), lReps = _n(l.reps);
      var cDue  = _n(c.due),  lDue  = _n(l.due);
      merged[id] = (cReps > lReps) || (cReps === lReps && cDue > lDue) ? c : l;
    });

    _write('medpath_sm2', merged);
    if (typeof sm2Data !== 'undefined') Object.assign(sm2Data, merged);

    // Saved cards — union; never un-save a card the student saved elsewhere
    var lsaved = _read('medpath_saved', []);
    var csaved = cloud.saved || [];
    var msaved = Array.from(new Set(lsaved.concat(csaved)));
    _write('medpath_saved', msaved);
    if (typeof savedCards !== 'undefined') {
      msaved.forEach(function (t) { savedCards.add(t); });
    }
  }

  // ── Settings merge ───────────────────────────────────────────

  function _mergeSettings(cloud) {
    var cdata = cloud.data || {};
    if (!Object.keys(cdata).length) return; // no cloud settings yet
    // Merge cloud into local (cloud wins for any key that exists in both)
    var ldata = _read('medpath_settings', {});
    var merged = Object.assign({}, ldata, cdata);
    _write('medpath_settings', merged);
    if (typeof appSettings !== 'undefined') Object.assign(appSettings, merged);
  }

  // ── Custom cards merge ───────────────────────────────────────

  function _mergeCustomCards(cloud) {
    var ldata = _read('medpath_custom_cards', {});
    var cdata = cloud.data || {};
    var merged = Object.assign({}, ldata);

    // For each panel in the cloud: add any cards not already in local
    Object.keys(cdata).forEach(function (panelId) {
      if (!merged[panelId]) {
        merged[panelId] = cdata[panelId];
      } else {
        var localIds = new Set(merged[panelId].map(function (c) { return c.id; }));
        cdata[panelId].forEach(function (card) {
          if (!localIds.has(card.id)) merged[panelId].push(card);
        });
      }
    });

    _write('medpath_custom_cards', merged);
    if (typeof _customCards !== 'undefined') Object.assign(_customCards, merged);
  }

  // ════════════════════════════════════════════════════════════════
  //  PUSH  (local → cloud)
  // ════════════════════════════════════════════════════════════════

  /** Push all four tables at once. Used on sign-in merge and sign-out. */
  async function _pushAll() {
    if (!_uid || !_ready) return;
    await Promise.all([
      _push('progress'),
      _push('srs'),
      _push('settings'),
      _push('custom_cards')
    ]);
  }

  /**
   * Push a single data type. Swallows network errors gracefully —
   * localStorage is always the source of truth.
   */
  async function _push(type) {
    if (!_uid || !_ready) return;
    try {
      var now = new Date().toISOString();

      if (type === 'progress') {
        await _db.from('user_progress').upsert({
          user_id:      _uid,
          xp:           _read('medpath_xp',          {}),
          streak:       _read('medpath_streak',       {}),
          case_stats:   _read('medpath_case_stats',   {}),
          quiz_stats:   _read('medpath_quiz_stats',   {}),
          study_log:    _read('medpath_study_log',    {}),
          achievements: _read('medpath_achievements', []),
          updated_at:   now
        }, { onConflict: 'user_id' });

      } else if (type === 'srs') {
        await _db.from('user_srs').upsert({
          user_id:    _uid,
          sm2:        _read('medpath_sm2',    {}),
          saved:      _read('medpath_saved',  []),
          updated_at: now
        }, { onConflict: 'user_id' });

      } else if (type === 'settings') {
        await _db.from('user_settings').upsert({
          user_id:    _uid,
          data:       _read('medpath_settings', {}),
          updated_at: now
        }, { onConflict: 'user_id' });

      } else if (type === 'custom_cards') {
        await _db.from('user_custom_cards').upsert({
          user_id:    _uid,
          data:       _read('medpath_custom_cards', {}),
          updated_at: now
        }, { onConflict: 'user_id' });
      }

    } catch (err) {
      console.warn('[MedPath Sync] Push error (' + type + '):', err.message);
      // Non-fatal — data is safe in localStorage
    }
  }

  /**
   * Schedule a debounced push for one data type.
   * Called from every save function in script.js.
   * Multiple rapid saves collapse into one network request.
   */
  function schedulePush(type) {
    if (!_ready || !_uid) return;
    clearTimeout(_timers[type]);
    _timers[type] = setTimeout(function () { _push(type); }, DEBOUNCE_MS);
  }

  // ════════════════════════════════════════════════════════════════
  //  UI REFRESH  (called after merge to update visible elements)
  // ════════════════════════════════════════════════════════════════

  function _refreshUI() {
    try {
      if (typeof updateXPBar          === 'function') updateXPBar();
      if (typeof updateStatsStrip     === 'function') updateStatsStrip();
      if (typeof renderAchievements   === 'function') renderAchievements();
      if (typeof renderFCCategories   === 'function') renderFCCategories();
      if (typeof initDiffCounts       === 'function') initDiffCounts();
    } catch (e) { /* non-fatal */ }
  }

  // ════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════

  /** Read + parse a localStorage key safely. */
  function _read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  /** Stringify + write to localStorage safely. */
  function _write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  /** Parse a number, default to 0. */
  function _n(v, def) { var n = parseFloat(v); return isNaN(n) ? (def || 0) : n; }

  /** Union two arrays, deduplicating by value. */
  function _union(a, b) {
    return Array.from(new Set((a || []).concat(b || [])));
  }

  /** Return the lexicographically later ISO date string (or the one that's not null). */
  function _laterDate(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a >= b ? a : b;
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  return {
    init:           init,
    onGoogleSignIn: onGoogleSignIn,
    onSignOut:      onSignOut,
    schedulePush:   schedulePush,

    // ── Admin API ──────────────────────────────────────────────
    /** Fetch all app_config rows as { key: value } map */
    fetchAppConfig: async function() {
      if (!_ready) return {};
      try {
        var r = await _db.from('app_config').select('key,value');
        var map = {};
        (r.data || []).forEach(function(row) { map[row.key] = row.value; });
        return map;
      } catch(e) { console.warn('[Admin] fetchConfig:', e.message); return {}; }
    },
    /** Upsert a single config key */
    saveAppConfig: async function(key, value) {
      if (!_ready || !_uid) return false;
      try {
        var r = await _db.from('app_config')
          .upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return !r.error;
      } catch(e) { console.warn('[Admin] saveConfig:', e.message); return false; }
    },
    /** Pull aggregate stats for the admin dashboard */
    fetchAdminStats: async function() {
      if (!_ready) return null;
      try {
        var [total, active, rows] = await Promise.all([
          _db.from('leaderboard').select('*', { count: 'exact', head: true }),
          _db.from('leaderboard').select('*', { count: 'exact', head: true }).gt('week_xp', 0),
          _db.from('leaderboard').select('total_xp,display_name,level,streak').order('total_xp', { ascending: false }).limit(10)
        ]);
        var totalXP = (rows.data || []).reduce(function(s, r) { return s + (r.total_xp || 0); }, 0);
        return {
          totalUsers:     total.count  || 0,
          activeThisWeek: active.count || 0,
          totalXP:        totalXP,
          topUsers:       rows.data    || []
        };
      } catch(e) { console.warn('[Admin] fetchStats:', e.message); return null; }
    },
    /** Reset every user's week_xp to 0 */
    resetWeeklyXP: async function() {
      if (!_ready || !_uid) return false;
      try {
        var r = await _db.from('leaderboard').update({ week_xp: 0, week_start: new Date().toISOString().split('T')[0] });
        return !r.error;
      } catch(e) { console.warn('[Admin] resetWeekly:', e.message); return false; }
    },

    // ── Leaderboard ────────────────────────────────────────────
    pushLeaderboard: async function(data) {
      if (!_ready || !_uid) return;
      return _db.from('leaderboard')
        .upsert(Object.assign({ user_id: _uid, updated_at: new Date().toISOString() }, data), { onConflict: 'user_id' })
        .catch(function(e) { console.warn('[Sync] lb push:', e.message); });
    },
    fetchLeaderboard: async function(sortField) {
      if (!_ready) return [];
      try {
        var r = await _db.from('leaderboard').select('*').order(sortField, { ascending: false }).limit(50);
        return r.data || [];
      } catch(e) { return []; }
    },
    fetchMyRank: async function(sortField) {
      if (!_ready || !_uid) return null;
      try {
        var my = await _db.from('leaderboard').select(sortField).eq('user_id', _uid).maybeSingle();
        if (!my.data) return null;
        var above = await _db.from('leaderboard').select('*', { count: 'exact', head: true }).gt(sortField, my.data[sortField] || 0);
        return (above.count || 0) + 1;
      } catch(e) { return null; }
    },

    // ── Clubs ──────────────────────────────────────────────────
    createClub: async function(name, displayName, avatar) {
      if (!_ready || !_uid) return null;
      var id   = Math.random().toString(36).substr(2, 8).toUpperCase();
      var code = Math.random().toString(36).substr(2, 6).toUpperCase();
      try {
        var r = await _db.from('clubs')
          .insert({ id: id, name: name, join_code: code, owner_id: _uid })
          .select().single();
        if (r.error) throw r.error;
        await _db.from('club_members').insert({
          club_id: id, user_id: _uid, role: 'owner',
          display_name: displayName || '', avatar_url: avatar || ''
        });
        return r.data;
      } catch(e) { console.warn('[Clubs] create:', e.message); return null; }
    },
    joinClub: async function(code, displayName, avatar) {
      if (!_ready || !_uid) return 'Not signed in';
      try {
        var r = await _db.from('clubs').select('*').eq('join_code', code.trim().toUpperCase()).maybeSingle();
        if (r.error) throw r.error;
        if (!r.data) return 'Club not found — check the code and try again';
        var ex = await _db.from('club_members').select('role').eq('club_id', r.data.id).eq('user_id', _uid).maybeSingle();
        if (ex.data) return 'already_member:' + r.data.id;
        await _db.from('club_members').insert({
          club_id: r.data.id, user_id: _uid, role: 'student',
          display_name: displayName || '', avatar_url: avatar || ''
        });
        return r.data;
      } catch(e) { console.warn('[Clubs] join:', e.message); return e.message; }
    },
    fetchMyClubs: async function() {
      if (!_ready || !_uid) return [];
      try {
        var m = await _db.from('club_members').select('club_id,role').eq('user_id', _uid);
        if (!m.data || !m.data.length) return [];
        var ids = m.data.map(function(x) { return x.club_id; });
        var cl  = await _db.from('clubs').select('*').in('id', ids);
        var rm  = {};
        m.data.forEach(function(x) { rm[x.club_id] = x.role; });
        return (cl.data || []).map(function(c) { return Object.assign({}, c, { myRole: rm[c.id] || 'student' }); });
      } catch(e) { console.warn('[Clubs] myClubs:', e.message); return []; }
    },
    fetchClubMembers: async function(clubId) {
      if (!_ready) return [];
      try { var r = await _db.from('club_members').select('*').eq('club_id', clubId); return r.data || []; } catch(e) { return []; }
    },
    fetchClubStats: async function(clubId) {
      if (!_ready) return [];
      try { var r = await _db.from('club_member_stats').select('*').eq('club_id', clubId); return r.data || []; } catch(e) { return []; }
    },
    pushMemberStats: async function(clubId, stats) {
      if (!_ready || !_uid) return;
      try {
        await _db.from('club_member_stats').upsert(
          Object.assign({ user_id: _uid, club_id: clubId, updated_at: new Date().toISOString() }, stats),
          { onConflict: 'user_id,club_id' }
        );
      } catch(e) { console.warn('[Clubs] pushStats:', e.message); }
    },
    fetchAssignments: async function(clubId) {
      if (!_ready) return [];
      try {
        var r = await _db.from('assignments').select('*').eq('club_id', clubId).order('created_at', { ascending: false });
        return r.data || [];
      } catch(e) { return []; }
    },
    createAssignment: async function(data) {
      if (!_ready || !_uid) return null;
      try {
        var r = await _db.from('assignments').insert(Object.assign({ created_by: _uid }, data)).select().single();
        if (r.error) throw r.error;
        return r.data;
      } catch(e) { console.warn('[Clubs] createAssign:', e.message); return null; }
    },
    deleteAssignment: async function(id) {
      if (!_ready) return;
      try { await _db.from('assignments').delete().eq('id', id); } catch(e) { console.warn('[Clubs] delAssign:', e.message); }
    },
    leaveClub: async function(clubId) {
      if (!_ready || !_uid) return;
      try {
        await _db.from('club_members').delete().eq('club_id', clubId).eq('user_id', _uid);
        await _db.from('club_member_stats').delete().eq('club_id', clubId).eq('user_id', _uid);
      } catch(e) { console.warn('[Clubs] leave:', e.message); }
    },
    deleteClub: async function(clubId) {
      if (!_ready || !_uid) return;
      try { await _db.from('clubs').delete().eq('id', clubId).eq('owner_id', _uid); } catch(e) { console.warn('[Clubs] delete:', e.message); }
    },
    updateClub: async function(clubId, updates) {
      if (!_ready || !_uid) return false;
      try {
        var r = await _db.from('clubs').update(updates).eq('id', clubId).eq('owner_id', _uid);
        return !r.error;
      } catch(e) { console.warn('[Clubs] update:', e.message); return false; }
    },

    // ── Announcements ──────────────────────────────────────────
    fetchAnnouncements: async function(clubId) {
      if (!_ready) return [];
      try {
        var r = await _db.from('announcements').select('*').eq('club_id', clubId)
          .order('created_at', { ascending: false }).limit(20);
        return r.data || [];
      } catch(e) { return []; }
    },
    createAnnouncement: async function(data) {
      if (!_ready || !_uid) return null;
      try {
        var r = await _db.from('announcements')
          .insert(Object.assign({ created_by: _uid }, data)).select().single();
        if (r.error) throw r.error;
        return r.data;
      } catch(e) { console.warn('[Clubs] postAnn:', e.message); return null; }
    },
    deleteAnnouncement: async function(id) {
      if (!_ready) return;
      try { await _db.from('announcements').delete().eq('id', id); } catch(e) { console.warn('[Clubs] delAnn:', e.message); }
    }
  };

})();
