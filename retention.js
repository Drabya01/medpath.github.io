/* ═══════════════════════════════════════════════════════════════
   MedPath — Retention Features  v1
   Drop-in module — load AFTER script.js in <body>

   1. Daily Goal Ring   — SVG circular progress widget on home
   2. Streak Overhaul   — freeze · milestone popups · XP repair
   3. Achievement Badges — 5 new milestones + 4-tier rarity grid
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. DAILY GOAL RING
   Tracks cards reviewed today against a configurable daily target.
   Hooks into logStudyActivity() — already called after every card.
═══════════════════════════════════════════════════════════════ */

var DAILY_GOAL_KEY = 'medpath_daily_goal_v1';
var _goal = {
  goal:       20,       // default: 20 cards/day
  today:      null,     // 'YYYY-MM-DD' — resets on date change
  count:      0,        // cards reviewed today
  celebrated: false,    // daily-goal bonus already fired today
};

function _goalLoad() {
  try {
    var raw = localStorage.getItem(DAILY_GOAL_KEY);
    if (raw) { var parsed = JSON.parse(raw); Object.assign(_goal, parsed); }
  } catch (e) {}
  // Roll over if it's a new day
  var today = _today();
  if (_goal.today !== today) {
    _goal.today      = today;
    _goal.count      = 0;
    _goal.celebrated = false;
    _goalSave();
  }
}

function _goalSave() {
  try { localStorage.setItem(DAILY_GOAL_KEY, JSON.stringify(_goal)); } catch (e) {}
}

/** Called whenever a card is rated (via logStudyActivity hook) */
function _goalAdd() {
  var wasBelow = _goal.count < _goal.goal;
  _goal.count++;
  _goalSave();
  updateGoalRing();
  if (wasBelow && _goal.count >= _goal.goal && !_goal.celebrated) {
    _goal.celebrated = true;
    _goalSave();
    _goalCelebrate();
  }
}

/**
 * Redraws the SVG ring and counter.
 * Call this on page-load and after every card rating.
 * Safe to call when ring elements don't exist (other screens).
 */
function updateGoalRing() {
  var ring    = document.getElementById('goalRingCircle');
  var countEl = document.getElementById('goalRingCount');
  var goalEl  = document.getElementById('goalRingGoal');
  var wrap    = document.getElementById('goalRingWrap');
  if (!ring || !countEl) return;

  var pct  = Math.min(1, _goal.count / Math.max(1, _goal.goal));
  // r=46 → C = 2π×46 ≈ 289.03
  var C = 289.03;
  ring.style.strokeDashoffset = (C * (1 - pct)).toFixed(2);

  // Progress colour: dim white → amber → emerald
  ring.style.stroke = pct >= 1
    ? '#10b981'
    : pct >= 0.5
      ? '#f59e0b'
      : 'rgba(255,255,255,0.65)';

  if (countEl) countEl.textContent = _goal.count;
  if (goalEl)  goalEl.textContent  = _goal.goal;

  // Completed ring state
  if (wrap) wrap.classList.toggle('grw--done', pct >= 1);

  // Also refresh the streak number in the home hero
  _updateHomeStreak();
}

function _goalCelebrate() {
  if (typeof earnXP === 'function') earnXP(50, 'daily_goal');
  if (typeof showSettingsToast === 'function') showSettingsToast('🎯 Daily goal hit! +50 XP bonus');
  // Burst ring animation
  var wrap = document.getElementById('goalRingWrap');
  if (wrap) {
    wrap.classList.add('grw--burst');
    setTimeout(function () { wrap.classList.remove('grw--burst'); }, 900);
  }
}


/* ═══════════════════════════════════════════════════════════════
   2. STREAK OVERHAUL
═══════════════════════════════════════════════════════════════ */

var STREAK_EX_KEY = 'medpath_streak_ex_v1';
var _sx = {
  freezes:         0,   // freezes currently held (max 3)
  freezesEarned:   0,   // lifetime earned (used to detect new milestones)
  milestonesSeen:  [],  // streak days whose popup already appeared: e.g. [7,30]
  repairable:      false,
  repairOldStreak: 0,
  repairCost:      50,
  perfectQuizzes:  0,   // tracks perfect_10 achievement
  expertCorrect:   0,   // tracks hard_mode achievement
};

function _sxLoad() {
  try {
    var raw = localStorage.getItem(STREAK_EX_KEY);
    if (raw) { var p = JSON.parse(raw); Object.assign(_sx, p); }
  } catch (e) {}
}

function _sxSave() {
  try { localStorage.setItem(STREAK_EX_KEY, JSON.stringify(_sx)); } catch (e) {}
}

/* ── Pre-hook: runs BEFORE original updateStreak() ─────────── */
function _streakPreHook() {
  if (typeof progressStreak === 'undefined') return;
  var today      = _today();
  var yesterday  = _yesterday();
  var twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

  // Already counted today — nothing to intercept
  if (progressStreak.lastVisit === today) return;

  // A break is about to happen (lastVisit is not today, not yesterday)
  if (progressStreak.lastVisit &&
      progressStreak.lastVisit !== today &&
      progressStreak.lastVisit !== yesterday &&
      (progressStreak.currentStreak || 0) > 0) {

    var exactlyOneMissed = (progressStreak.lastVisit === twoDaysAgo);

    if (exactlyOneMissed && _sx.freezes > 0) {
      // Auto-consume one freeze to bridge the 1-day gap
      _sx.freezes--;
      _sxSave();
      // Set lastVisit = yesterday so the original function increments, not resets
      progressStreak.lastVisit = yesterday;
      setTimeout(function () {
        if (typeof showSettingsToast === 'function') {
          showSettingsToast('🧊 Streak freeze used — your streak is safe!');
        }
        _renderFreezePips();
      }, 200);

    } else if ((progressStreak.currentStreak || 0) >= 3) {
      // Streak will break. Remember the old value; offer repair after the reset.
      var oldStreak = progressStreak.currentStreak;
      _sx.repairable      = true;
      _sx.repairOldStreak = oldStreak;
      _sx.repairCost      = Math.min(200, 50 + Math.floor(oldStreak / 5) * 25);
      _sxSave();
      setTimeout(function () { _showRepairPrompt(oldStreak, _sx.repairCost); }, 1400);
    }
  }
}

/* ── Post-hook: runs AFTER original updateStreak() ────────── */
function _streakPostHook() {
  if (typeof progressStreak === 'undefined') return;
  var current = progressStreak.currentStreak || 0;

  // Award a freeze for each completed multiple of 7 (max 3 held)
  var deserved = Math.floor(current / 7);
  if (deserved > _sx.freezesEarned && _sx.freezes < 3) {
    var gained        = Math.min(3 - _sx.freezes, deserved - _sx.freezesEarned);
    _sx.freezes      += gained;
    _sx.freezesEarned = deserved;
    _sxSave();
    setTimeout(function () {
      if (typeof showSettingsToast === 'function') {
        showSettingsToast('🧊 Streak Freeze earned! (' + _sx.freezes + '/3 saved)');
      }
      _renderFreezePips();
    }, 600);
  }

  // Milestone celebration popups (once per milestone)
  [7, 30, 100].forEach(function (m) {
    if (current >= m && _sx.milestonesSeen.indexOf(m) === -1) {
      _sx.milestonesSeen.push(m);
      _sxSave();
      setTimeout(function () { _showMilestonePopup(m); }, 900);
    }
  });

  // Achievement hooks
  if (typeof achUnlock === 'function') {
    if (current >= 100) achUnlock('streak_100');
    // week_warrior and diamond are already handled in script.js streak hook
  }

  _renderFreezePips();
  _renderRepairButton();
  _updateHomeStreak();
}

/** Sync the streak number visible in the home hero */
function _updateHomeStreak() {
  var el = document.getElementById('goalStreakNum');
  if (el && typeof progressStreak !== 'undefined') {
    el.textContent = progressStreak.currentStreak || 0;
  }
}

/** Render the 3 freeze pip icons (hollow or lit) */
function _renderFreezePips() {
  document.querySelectorAll('.sfr-pips').forEach(function (c) {
    var html = '';
    for (var i = 0; i < 3; i++) {
      html += '<span class="freeze-pip' + (i < _sx.freezes ? ' freeze-pip--lit' : '') + '" title="'
        + (i < _sx.freezes ? 'Freeze available' : 'No freeze') + '">🧊</span>';
    }
    c.innerHTML = html;
  });
}

/** Show / hide the repair button on the progress page */
function _renderRepairButton() {
  var btn = document.getElementById('streakRepairBtn');
  if (!btn) return;
  var canRepair = _sx.repairable
    && typeof xpData !== 'undefined'
    && xpData.totalXP >= _sx.repairCost;
  btn.classList.toggle('hidden', !canRepair);
  if (canRepair) btn.textContent = '🔧 Repair streak (−' + _sx.repairCost + ' XP)';
}

/** Inject the freeze-pips + repair-button row below the streak banner (once) */
function _injectStreakExtras() {
  if (document.getElementById('streakExtrasRow')) return;
  var banner = document.querySelector('.pd-streak-banner');
  if (!banner) return;
  var row = document.createElement('div');
  row.id = 'streakExtrasRow';
  row.className = 'srx-row';
  row.innerHTML =
    '<div class="srx-freeze">'
    + '<span class="srx-freeze-label">Freezes:</span>'
    + '<span class="sfr-pips" id="streakFreezePips"></span>'
    + '<span class="srx-freeze-hint">earn one every 7 days&nbsp;·&nbsp;max 3</span>'
    + '</div>'
    + '<button id="streakRepairBtn" class="srx-repair-btn hidden" onclick="streakRepair()">🔧 Repair streak</button>';
  banner.insertAdjacentElement('afterend', row);
  _renderFreezePips();
  _renderRepairButton();
}

/* ── Streak repair (called from repair button and overlay) ─── */
window.streakRepair = function () {
  if (!_sx.repairable || typeof xpData === 'undefined') return;
  if (xpData.totalXP < _sx.repairCost) return;
  xpData.totalXP -= _sx.repairCost;
  if (typeof xpSave       === 'function') xpSave();
  if (typeof updateXPBar  === 'function') updateXPBar();
  // Restore the pre-break streak
  if (typeof progressStreak !== 'undefined') {
    progressStreak.currentStreak = _sx.repairOldStreak;
    if (progressStreak.currentStreak > (progressStreak.longestStreak || 0)) {
      progressStreak.longestStreak = progressStreak.currentStreak;
    }
    progressStreak.lastVisit = _today();
    if (typeof saveProgressData === 'function') saveProgressData();
  }
  _sx.repairable = false;
  _sxSave();
  if (typeof showSettingsToast === 'function') {
    showSettingsToast('✅ Streak restored! −' + _sx.repairCost + ' XP');
  }
  _dismissRepairPrompt();
  _streakPostHook();
  if (typeof renderProgressDashboard === 'function') renderProgressDashboard();
};

/* ── Repair prompt overlay ──────────────────────────────────── */
function _showRepairPrompt(oldStreak, cost) {
  if (document.getElementById('srpOverlay')) return;
  var hasXP = typeof xpData !== 'undefined' && xpData.totalXP >= cost;
  var el = document.createElement('div');
  el.id = 'srpOverlay';
  el.className = 'srp-overlay';
  el.innerHTML =
    '<div class="srp-card" role="dialog" aria-modal="true">'
    + '<div class="srp-icon">💔</div>'
    + '<h3 class="srp-title">Streak broken</h3>'
    + '<p class="srp-msg">Your <strong>' + oldStreak + '-day streak</strong> ended.<br>'
    + 'Repair it now before it\'s gone for good.</p>'
    + (hasXP
      ? '<button class="srp-btn srp-btn--repair" onclick="streakRepair()">🔧 Repair for ' + cost + ' XP</button>'
      : '<div class="srp-noxp">Need <strong>' + cost + ' XP</strong> to repair. Study more to earn it!</div>')
    + '<button class="srp-btn srp-btn--skip" onclick="_dismissRepairPrompt()">Not now</button>'
    + '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { el.classList.add('srp--in'); });
  });
}

window._dismissRepairPrompt = function () {
  var el = document.getElementById('srpOverlay');
  if (!el) return;
  el.classList.remove('srp--in');
  setTimeout(function () { if (el.parentNode) el.remove(); }, 420);
};

/* ── Milestone celebration popup ────────────────────────────── */
function _showMilestonePopup(days) {
  var cfgs = {
    7:   { emoji:'🔥', color:'#f59e0b', xp:100,  title:'7-Day Streak!',  sub:'You\'ve built a real habit. One week down.' },
    30:  { emoji:'🌟', color:'#8b5cf6', xp:500,  title:'30-Day Streak!', sub:'A whole month of consistency. Remarkable.' },
    100: { emoji:'💎', color:'#0d9488', xp:2000, title:'100-Day Streak!',sub:'Elite dedication. You are genuinely unstoppable.' },
  };
  var c = cfgs[days];
  if (!c) return;

  if (typeof earnXP === 'function') earnXP(c.xp, 'streak_milestone');

  var el = document.createElement('div');
  el.className = 'smo-overlay';
  el.innerHTML =
    '<div class="smo-card" style="--smo-clr:' + c.color + '">'
    + '<div class="smo-confetti-stage" id="smoConfetti"></div>'
    + '<div class="smo-emoji">' + c.emoji + '</div>'
    + '<div class="smo-count">' + days + '</div>'
    + '<div class="smo-count-lbl">day streak</div>'
    + '<h2 class="smo-title">' + c.title + '</h2>'
    + '<p class="smo-sub">' + c.sub + '</p>'
    + '<div class="smo-xp">+' + c.xp.toLocaleString() + ' XP</div>'
    + '<button class="smo-btn" onclick="this.closest(\'.smo-overlay\').remove()">Keep going →</button>'
    + '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      el.classList.add('smo--in');
      setTimeout(_spawnMilestoneConfetti, 320);
    });
  });
}

function _spawnMilestoneConfetti() {
  var stage = document.getElementById('smoConfetti');
  if (!stage) return;
  var clrs = ['#0d9488','#f59e0b','#8b5cf6','#ec4899','#3b82f6','#10b981','#ef4444','#f97316'];
  var html = '';
  for (var i = 0; i < 60; i++) {
    var c   = clrs[i % clrs.length];
    var dx  = (Math.random() * 300 - 150).toFixed(1);
    var dy  = -(Math.random() * 230 + 90).toFixed(1);
    var rot = (Math.random() * 660 - 330).toFixed(1);
    var del = (Math.random() * 0.44).toFixed(2);
    var w   = (Math.random() * 12 + 5).toFixed(1);
    var h   = (Math.random() * 7  + 3).toFixed(1);
    var br  = Math.random() > 0.5 ? '50%' : '2px';
    html += '<div class="smo-conf" style="'
          + '--c:' + c + ';--dx:' + dx + 'px;--dy:' + dy + 'px;'
          + '--rot:' + rot + 'deg;--del:' + del + 's;'
          + 'width:' + w + 'px;height:' + h + 'px;border-radius:' + br + '">'
          + '</div>';
  }
  stage.innerHTML = html;
}


/* ═══════════════════════════════════════════════════════════════
   3. ACHIEVEMENT BADGES — 5 new milestones + premium 4-tier grid
═══════════════════════════════════════════════════════════════ */

// Additional achievements not in the original 20
var EXTRA_ACHIEVEMENTS = [
  { id:'streak_100',  icon:'💎', name:'100-Day Legend', desc:'Achieve a 100-day study streak' },
  { id:'perfect_10',  icon:'🎯', name:'Perfect 10',     desc:'Score 100% on 10 different quizzes' },
  { id:'early_bird',  icon:'🌅', name:'Early Bird',     desc:'Study before 7 am' },
  { id:'team_player', icon:'🤝', name:'Team Player',    desc:'Join or create a study club' },
  { id:'hard_mode',   icon:'💪', name:'Hard Mode',      desc:'Get 10 Expert-level cases right' },
];

// Rarity tier for every achievement (original + new)
var BADGE_RARITY = {
  // Bronze — common, first-time actions
  first_flip:   'bronze',
  night_owl:    'bronze',
  speed_run:    'bronze',
  star_saver:   'bronze',
  comeback:     'bronze',
  early_bird:   'bronze',
  // Silver — moderate effort
  on_a_roll:    'silver',
  century:      'silver',
  case_cracker: 'silver',
  quiz_ace:     'silver',
  week_warrior: 'silver',
  hosa_hero:    'silver',
  explorer:     'silver',
  team_player:  'silver',
  level_5:      'silver',
  // Gold — serious milestones
  memory_500:   'gold',
  bookworm:     'gold',
  clinician:    'gold',
  diamond:      'gold',
  xp_10k:       'gold',
  deck_complete:'gold',
  hard_mode:    'gold',
  perfect_10:   'gold',
  level_10:     'gold',
  // Diamond — lifetime elite
  streak_100:   'diamond',
};

/**
 * Premium achievement grid renderer.
 * Replaces the basic renderAchievements() — call this instead.
 */
function _renderAchievementsV2() {
  var grid = document.getElementById('achGrid');
  if (!grid || typeof ACHIEVEMENTS === 'undefined') return;

  var all      = ACHIEVEMENTS;
  var unlocked = (typeof achUnlocked !== 'undefined') ? achUnlocked : new Set();
  var rOrder   = { diamond:0, gold:1, silver:2, bronze:3 };

  // Sort: unlocked first → then by rarity desc (diamond at top)
  var sorted = all.slice().sort(function (a, b) {
    var au = unlocked.has(a.id), bu = unlocked.has(b.id);
    if (au !== bu) return au ? -1 : 1;
    var ar = rOrder[BADGE_RARITY[a.id] || 'bronze'];
    var br = rOrder[BADGE_RARITY[b.id] || 'bronze'];
    return ar - br;
  });

  var total     = sorted.length;
  var unlockedN = sorted.filter(function (a) { return unlocked.has(a.id); }).length;

  grid.innerHTML =
    '<div class="ach2-header">'
    + '<div class="ach2-progress-row">'
    + '<span class="ach2-tally">' + unlockedN + ' <span class="ach2-tally-sep">/</span> ' + total + '</span>'
    + '<span class="ach2-tally-lbl">achievements</span>'
    + '</div>'
    + '<div class="ach2-legend">'
    + '<span class="ach2-gem ach2-gem--bronze" title="Common">Bronze</span>'
    + '<span class="ach2-gem ach2-gem--silver" title="Uncommon">Silver</span>'
    + '<span class="ach2-gem ach2-gem--gold"   title="Rare">Gold</span>'
    + '<span class="ach2-gem ach2-gem--diamond" title="Elite">Diamond</span>'
    + '</div>'
    + '</div>'
    + '<div class="ach2-grid">'
    + sorted.map(function (a) {
        var isLit  = unlocked.has(a.id);
        var rarity = BADGE_RARITY[a.id] || 'bronze';
        return '<div class="ach2-badge ach2-' + rarity + (isLit ? ' ach2-lit' : '') + '" title="' + (isLit ? '✓ ' : '') + a.name + ': ' + a.desc + '">'
          + '<div class="ach2-glow"></div>'
          + '<div class="ach2-body">'
          + '<div class="ach2-emoji">' + a.icon + '</div>'
          + (isLit ? '<div class="ach2-check">✓</div>' : '')
          + '</div>'
          + '<div class="ach2-name">' + a.name + '</div>'
          + '<div class="ach2-desc' + (isLit ? '' : ' ach2-locked') + '">' + (isLit ? '' : '🔒 ') + a.desc + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}


/* ═══════════════════════════════════════════════════════════════
   INIT — wire everything up once DOM is ready
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  // ── Load persistent data ────────────────────────────────────
  _goalLoad();
  _sxLoad();

  // ── Merge extra achievements ─────────────────────────────────
  if (typeof ACHIEVEMENTS !== 'undefined') {
    EXTRA_ACHIEVEMENTS.forEach(function (ea) {
      if (!ACHIEVEMENTS.find(function (a) { return a.id === ea.id; })) {
        ACHIEVEMENTS.push(ea);
      }
    });
  }

  // ── Wrap updateStreak (freeze + milestone + repair) ─────────
  if (typeof updateStreak === 'function') {
    var _origUS = updateStreak;
    window.updateStreak = function () {
      _streakPreHook(); // ← may adjust progressStreak.lastVisit before reset
      _origUS();        // ← runs original (already wrapped by achievements hook)
      _streakPostHook();// ← awards freezes, shows milestones
    };
  }

  // ── Wrap logStudyActivity → daily goal count + early bird ───
  if (typeof logStudyActivity === 'function') {
    var _origLSA = logStudyActivity;
    window.logStudyActivity = function (type) {
      _origLSA.apply(this, arguments);
      if (type === 'card') {
        _goalAdd();
        if (new Date().getHours() < 7 && typeof achUnlock === 'function') {
          achUnlock('early_bird');
        }
      }
    };
  }

  // ── Wrap recordQuizComplete → perfect_10 ─────────────────────
  if (typeof recordQuizComplete === 'function') {
    var _origRQC = recordQuizComplete;
    window.recordQuizComplete = function (score, total) {
      _origRQC.apply(this, arguments);
      if (total >= 5 && score >= total) {
        _sx.perfectQuizzes = (_sx.perfectQuizzes || 0) + 1;
        _sxSave();
        if (_sx.perfectQuizzes >= 10 && typeof achUnlock === 'function') {
          achUnlock('perfect_10');
        }
      }
    };
  }

  // ── Wrap recordCaseAnswer → hard_mode ────────────────────────
  if (typeof recordCaseAnswer === 'function') {
    var _origRCA = recordCaseAnswer;
    window.recordCaseAnswer = function (caseId, isCorrect, tag, difficulty) {
      _origRCA.apply(this, arguments);
      if (isCorrect && difficulty === 'expert') {
        _sx.expertCorrect = (_sx.expertCorrect || 0) + 1;
        _sxSave();
        if (_sx.expertCorrect >= 10 && typeof achUnlock === 'function') {
          achUnlock('hard_mode');
        }
      }
    };
  }

  // ── Wrap showScreen → inject progress extras + team_player ──
  if (typeof showScreen === 'function') {
    var _origSS = showScreen;
    window.showScreen = function (id) {
      _origSS.apply(this, arguments);
      if (id === 'progress') {
        setTimeout(function () {
          _injectStreakExtras();
          _renderAchievementsV2();
        }, 80);
      }
      if (id === 'club') {
        setTimeout(function () {
          if (typeof _clubState !== 'undefined' && _clubState.active && typeof achUnlock === 'function') {
            achUnlock('team_player');
          }
        }, 1500);
      }
      if (id === 'home') {
        updateGoalRing();
      }
    };
  }

  // ── Wrap renderProgressDashboard → inject extras after render
  if (typeof renderProgressDashboard === 'function') {
    var _origRPD = renderProgressDashboard;
    window.renderProgressDashboard = function () {
      _origRPD();
      _injectStreakExtras();
      _renderAchievementsV2();
      _renderFreezePips();
      _renderRepairButton();
    };
  }

  // ── Override renderAchievements with the v2 version ──────────
  window.renderAchievements = _renderAchievementsV2;

  // ── Initial renders ────────────────────────────────────────────
  updateGoalRing();
  _renderFreezePips();
  _renderAchievementsV2();
  _updateHomeStreak();
});


/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */

function _today() {
  return new Date().toISOString().split('T')[0];
}
function _yesterday() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}
