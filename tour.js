/* ══════════════════════════════════════════════════════════════
   MedPath — Feature Tour  v6
   GPU-only · 4-panel transform · screen-aware · 60fps

   v6 changes vs v5:
   ─ Navigates INTO each screen for in-context spotlights
   ─ Uses scrollIntoView({ behavior:'instant' }) — no coordinate lag
   ─ 14 detailed steps covering every feature + Weekly League
   ─ prep() hook per step for UI setup (e.g. showing hidden bars)
   ─ Multi-selector fallback: tries each target until one has size
   ─ Returns user to home screen on finish/skip
   ─ New tour key (v2) so existing users also see the improved tour
══════════════════════════════════════════════════════════════ */

var TOUR_KEY = 'medpath_tour_v2';   // bumped so everyone sees the new tour
var _tourResizeTimer;
var _t = {
  step: 0, active: false, profile: null, steps: [],
  prevTarget: null, currentScreen: 'home'
};

/* ─────────────────────────────────────────────────────────────
   STEP DEFINITIONS
   Each step can have:
     screen   – navigate here before spotlighting
     target   – CSS selector(s), tried in order; first with size wins
     emoji, color, title, body
     pos      – 'top' | 'bottom' | 'auto'
     prep()   – optional: called after screen loads, before measuring
     teardown() – optional: called when leaving this step
───────────────────────────────────────────────────────────── */
var _TOUR_STEPS = [

  /* 1 ── HOME: Welcome ───────────────────────────────────────── */
  {
    id: 'welcome', screen: 'home', target: '.mode-grid',
    emoji: '🏥', color: '#0d9488', pos: 'bottom',
    title: 'Welcome to MedPath',
    body: 'Your complete HOSA preparation toolkit — 7,000+ flashcards, clinical cases, anatomy, quizzes, competitive events, and weekly leagues. Let\'s take a quick tour of everything.'
  },

  /* 2 ── FLASHCARDS: Categories ──────────────────────────────── */
  {
    id: 'fc-cats', screen: 'flashcards', target: '#fcCategories',
    emoji: '🗂️', color: '#0d9488', pos: 'bottom',
    title: 'Study by Category',
    body: '20+ categories — Medical Terminology, Anatomy, Pharmacology, Pathophysiology, Cardiology, and more. Each category maintains its own SM-2 spaced-repetition schedule, so you never lose progress when switching topics.'
  },

  /* 3 ── FLASHCARDS: The Card ─────────────────────────────────── */
  {
    id: 'fc-card', screen: 'flashcards', target: '#flashcard',
    emoji: '📖', color: '#0d9488', pos: 'bottom',
    title: 'Tap to Flip',
    body: 'Every card shows a term, concept, or clinical scenario on the front. Tap to reveal the full answer. The SM-2 algorithm tracks exactly how well you know each one and schedules it to reappear precisely when your brain is about to forget it.'
  },

  /* 4 ── FLASHCARDS: SRS Rating ────────────────────────────────── */
  {
    id: 'fc-srs', screen: 'flashcards', target: '#fcSrsRow',
    emoji: '⭐', color: '#0d9488', pos: 'top',
    title: 'Rate Your Confidence',
    body: 'Four buttons appear after you flip: Again (back in minutes), Hard (reduced interval), Good (normal schedule), Easy (long interval). Honest ratings build the most accurate schedule — the algorithm is only as good as your self-assessment.'
  },

  /* 5 ── FLASHCARDS: Mixed Mode ────────────────────────────────── */
  {
    id: 'fc-mixed', screen: 'flashcards',
    target: ['.fc-cat-btn--mixed', '#fcCategories'],
    emoji: '🔀', color: '#8b5cf6', pos: 'bottom',
    prep: function () {
      // Ensure the mixed button is rendered
      if (typeof renderFCCategories === 'function') renderFCCategories();
    },
    title: 'Mixed Mode — Interleaved Study',
    body: 'Automatically picks your 3 weakest categories and shuffles them in an ABCABC pattern. Research shows interleaved practice improves long-term retention by 40% over studying one category at a time — the brain works harder and remembers longer.'
  },

  /* 6 ── FLASHCARDS: Feynman Voice Mode ────────────────────────── */
  {
    id: 'fc-feynman', screen: 'flashcards',
    target: ['#feynmanToggleBtn', '#fcStudyBar'],
    emoji: '🎤', color: '#0d9488', pos: 'bottom',
    prep: function () {
      // Temporarily reveal the study bar so the mic button is visible
      var bar  = document.getElementById('fcStudyBar');
      var name = document.getElementById('fcStudyCatName');
      if (bar)  { bar.classList.remove('hidden'); bar._tourRestore = true; }
      if (name) name.textContent = 'Any Category';
    },
    teardown: function () {
      var bar = document.getElementById('fcStudyBar');
      if (bar && bar._tourRestore) {
        bar.classList.add('hidden');
        delete bar._tourRestore;
      }
    },
    title: 'Feynman Voice Mode 🎤',
    body: 'Tap the mic icon to explain each concept aloud before flipping. The Web Speech API transcribes your words in real time. After you flip, self-assess: Nailed it / Pretty close / Missed details / Way off — which maps directly to Easy / Good / Hard / Again. If you can\'t explain it simply, you haven\'t truly learned it.'
  },

  /* 7 ── CASE MODE ─────────────────────────────────────────────── */
  {
    id: 'case', screen: 'case', target: '#case-difficulty-picker',
    emoji: '🏥', color: '#0284c7', pos: 'bottom',
    title: 'Clinical Case Mode — 4 Difficulties',
    body: 'Beginner to Expert. Each case presents a real patient: chief complaint, history, vitals, exam, labs, imaging, diagnosis, and full management plan. Work through the reasoning before revealing the answer. Build the clinical thinking that HOSA judges reward.'
  },

  /* 8 ── ANATOMY ───────────────────────────────────────────────── */
  {
    id: 'anatomy', screen: 'anatomy', target: '#anatomy-list',
    emoji: '🫀', color: '#dc2626', pos: 'bottom',
    title: 'Interactive Anatomy Explorer',
    body: 'Choose any body system — Cardiovascular, Respiratory, Nervous, Musculoskeletal, and more. Each system has a labelled anatomical diagram with clickable hotspots. Tap any structure to explore its function, clinical relevance, associated diseases, and procedures.'
  },

  /* 9 ── QUIZ MODE ─────────────────────────────────────────────── */
  {
    id: 'quiz', screen: 'quiz', target: '.qz-mode-grid',
    emoji: '📝', color: '#7c3aed', pos: 'bottom',
    title: 'Quiz Mode — 4 Question Types',
    body: 'Multiple Choice, Short Answer, Matching, or a Mixed exam that mirrors real HOSA competitive event conditions. Accuracy is tracked per category so you always know exactly where to spend your next study session.'
  },

  /* 10 ── HOSA EVENTS ──────────────────────────────────────────── */
  {
    id: 'hosa', screen: 'hosa', target: '.hosa-category',
    emoji: '🏆', color: '#d97706', pos: 'bottom',
    title: 'All 55 HOSA Events Covered',
    body: 'Every competitive event organised by category — Health Science, Health Professions, Emergency Preparedness, Leadership, Teamwork, and Recognition. Each event has its study guide, scoring rubric, practice resources, and current guidelines. Always up to date.'
  },

  /* 11 ── PROGRESS: Streak ─────────────────────────────────────── */
  {
    id: 'progress-streak', screen: 'progress', target: '.pd-streak-banner',
    emoji: '🔥', color: '#f59e0b', pos: 'bottom',
    title: 'Streak + Freeze Protection',
    body: 'Your daily study streak is protected by automatic freeze tokens earned every 7 days. Miss a day with a freeze saved? It\'s consumed silently — streak intact. Hit 7, 30, or 100 days and a full-screen milestone celebration fires with confetti and an XP bonus.'
  },

  /* 12 ── PROGRESS: Mastery breakdown ─────────────────────────── */
  {
    id: 'progress-mastery', screen: 'progress',
    target: ['#pdFCBar', '#pdFCStudied'],
    emoji: '📊', color: '#059669', pos: 'bottom',
    title: 'Deep Mastery Tracking',
    body: 'Flashcard mastery is broken down per category — strongest and weakest highlighted in green and amber. Case accuracy is tracked by difficulty and medical tag. Quiz scores show trend over time. You always know exactly what to study next.'
  },

  /* 13 ── PROGRESS: Achievements ──────────────────────────────── */
  {
    id: 'progress-ach', screen: 'progress', target: '#achGrid',
    emoji: '🏅', color: '#7c3aed', pos: 'top',
    title: '25 Achievement Badges',
    body: 'Four rarity tiers: Bronze · Silver · Gold · Diamond. From First Flip to 100-Day Legend to Perfect 10. Diamond badges pulse with a glow. Students screenshot and share these — they\'re genuinely hard to earn and worth showing off.'
  },

  /* 14 ── WEEKLY LEAGUE ─────────────────────────────────────────── */
  {
    id: 'league', screen: 'leaderboard',
    target: ['.lb-tabs', '#leagueBanner', '#screen-leaderboard .screen-header'],
    emoji: '⚔️', color: '#f59e0b', pos: 'bottom',
    title: 'Weekly League — Compete Every Week',
    body: 'You compete in a division of 30 students ranked by weekly XP. Top 10 (green zone) promote to a higher tier next Monday. Bottom 10 (red zone) get relegated. Tiers go Bronze → Silver → Gold → Platinum → Diamond. The threat of demotion is the single most powerful study motivator — even beats streaks.'
  },
];


/* ══════════════════════════════════════════════════════════════
   GPU PANEL MATH (unchanged from v5 — no layout/paint on move)
══════════════════════════════════════════════════════════════ */

function _movePanels(rect, pad) {
  var W  = window.innerWidth, H = window.innerHeight;
  var t  = Math.max(0, rect.top    - pad);
  var b  = Math.max(0, H - rect.bottom - pad);
  var l  = Math.max(0, rect.left   - pad);
  var r  = Math.min(W, rect.right  + pad);
  var sh = Math.max(1, rect.height + 2 * pad);
  var tp = document.getElementById('tp-top'), bp = document.getElementById('tp-bot'),
      lp = document.getElementById('tp-lft'), rp = document.getElementById('tp-rgt');
  if (!tp) return;
  tp.style.transform = 'scaleY('     + (t / H).toFixed(5) + ')';
  bp.style.transform = 'scaleY('     + (b / H).toFixed(5) + ')';
  lp.style.transform = 'translateY(' + t + 'px) scaleX(' + (l / W).toFixed(5) + ') scaleY(' + (sh / H).toFixed(5) + ')';
  rp.style.transform = 'translateX(' + r + 'px) translateY(' + t + 'px) scaleX(' + ((W - r) / W).toFixed(5) + ') scaleY(' + (sh / H).toFixed(5) + ')';
  tp.style.opacity = bp.style.opacity = lp.style.opacity = rp.style.opacity = '1';
}

function _closePanels() {
  var tp = document.getElementById('tp-top'), bp = document.getElementById('tp-bot'),
      lp = document.getElementById('tp-lft'), rp = document.getElementById('tp-rgt');
  if (tp) tp.style.transform = 'scaleY(0.5001)';
  if (bp) bp.style.transform = 'scaleY(0.5001)';
  if (lp) { lp.style.transform = 'translateY(50vh) scaleX(0) scaleY(0.001)'; lp.style.opacity = '0'; }
  if (rp) { rp.style.transform = 'translateX(100vw) translateY(50vh) scaleX(0) scaleY(0.001)'; rp.style.opacity = '0'; }
}

function _moveRing(rect, pad, color) {
  var rg = document.getElementById('t-ring'); if (!rg) return;
  rg.style.left        = (rect.left   - pad) + 'px';
  rg.style.top         = (rect.top    - pad) + 'px';
  rg.style.width       = (rect.width  + 2 * pad) + 'px';
  rg.style.height      = (rect.height + 2 * pad) + 'px';
  rg.style.borderColor = color;
  rg.style.boxShadow   = '0 0 0 3px ' + color + '20, 0 0 20px ' + color + '28';
  rg.style.opacity     = '1';
}


/* ══════════════════════════════════════════════════════════════
   ELEMENT FINDER — tries each target selector in order,
   returns the first that has non-zero dimensions
══════════════════════════════════════════════════════════════ */
function _tourFindEl(targets) {
  var list = Array.isArray(targets) ? targets : [targets];
  // First pass: find one with actual size
  for (var i = 0; i < list.length; i++) {
    var el = document.querySelector(list[i]);
    if (el) {
      var r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) return el;
    }
  }
  // Second pass: return first found even if zero-size
  for (var j = 0; j < list.length; j++) {
    var el2 = document.querySelector(list[j]);
    if (el2) return el2;
  }
  return null;
}


/* ══════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════ */
function tourStart(profile) {
  try { if (localStorage.getItem(TOUR_KEY)) return; } catch(e) {}
  setTimeout(function () {
    // Ensure we start on home
    if (typeof showScreen === 'function') showScreen('home');
    _t.profile = profile || {};
    _t.step    = 0;
    _t.active  = true;
    _t.prevTarget = null;
    _t.currentScreen = 'home';
    _t.steps = _TOUR_STEPS; // no filtering — all steps included
    _tourBuildDOM();
    setTimeout(function () { _tourRender(0); }, 300);
  }, 700);
}

function tourSkip() { _tourEnd(); }
function tourDone() { _tourEnd(); }

function _tourNext() {
  // Run teardown on current step
  var cur = _t.steps[_t.step];
  if (cur && typeof cur.teardown === 'function') cur.teardown();
  _t.step++;
  if (_t.step >= _t.steps.length) { _tourShowFinish(); return; }
  _tourTransitionTo(_t.step);
}

function _tourPrev() {
  if (_t.step <= 0) return;
  var cur = _t.steps[_t.step];
  if (cur && typeof cur.teardown === 'function') cur.teardown();
  _t.step--;
  _tourTransitionTo(_t.step);
}


/* ══════════════════════════════════════════════════════════════
   CORE RENDER — handles screen navigation + instant positioning
══════════════════════════════════════════════════════════════ */

/**
 * Navigate to the step's screen if needed, then position the spotlight.
 * Uses instant scrollIntoView so getBoundingClientRect() is always accurate.
 */
function _tourRender(idx) {
  var s = _t.steps[idx];
  if (!s) { _tourShowFinish(); return; }

  var targetScreen = s.screen || 'home';
  var activeEl     = document.querySelector('.screen.active');
  var activeId     = activeEl ? activeEl.id.replace('screen-', '') : 'home';

  if (activeId !== targetScreen) {
    // Navigate, then wait for the screen transition to complete
    if (typeof showScreen === 'function') showScreen(targetScreen);
    _t.currentScreen = targetScreen;
    setTimeout(function () { _tourPositionStep(idx); }, 380);
  } else {
    _tourPositionStep(idx);
  }
}

/**
 * Position panels + ring + tooltip for the step at idx.
 * Called after the correct screen is already active.
 */
function _tourPositionStep(idx) {
  var s = _t.steps[idx];
  if (!s) return;

  // Run prep (e.g. show hidden study bar)
  if (typeof s.prep === 'function') s.prep();

  // Clean up previous highlight
  if (_t.prevTarget) {
    _t.prevTarget.removeAttribute('data-tour-active');
    _t.prevTarget = null;
  }

  var el = _tourFindEl(s.target);
  if (!el) {
    // Element truly not found — skip this step silently
    _t.step = idx + 1;
    if (_t.step < _t.steps.length) _tourRender(_t.step);
    else _tourShowFinish();
    return;
  }

  // INSTANT scroll — getBoundingClientRect() accurate immediately after
  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });

  // One rAF to let the browser paint before measuring
  requestAnimationFrame(function () {
    var rect = el.getBoundingClientRect();
    var pad  = 10;

    el.setAttribute('data-tour-active', '');
    _t.prevTarget = el;

    var root = document.getElementById('tour-root');
    if (root) root.style.setProperty('--t-accent', s.color);

    _movePanels(rect, pad);
    _moveRing(rect, pad, s.color);
    _fillTooltip(s, rect, pad, idx);
  });
}


/* ══════════════════════════════════════════════════════════════
   FAST TRANSITION (same-screen, panel moves IMMEDIATELY)
══════════════════════════════════════════════════════════════ */
function _tourTransitionTo(nextIdx) {
  var tt = document.getElementById('t-tip');
  var rg = document.getElementById('t-ring');
  if (tt) tt.classList.add('t-tip-exit');
  if (rg) rg.style.opacity = '0.1';
  if (_t.prevTarget) {
    _t.prevTarget.removeAttribute('data-tour-active');
    _t.prevTarget = null;
  }

  var s  = _t.steps[nextIdx];
  if (!s) { _tourShowFinish(); return; }

  var targetScreen = s.screen || 'home';
  var activeEl     = document.querySelector('.screen.active');
  var activeId     = activeEl ? activeEl.id.replace('screen-', '') : 'home';

  if (activeId !== targetScreen) {
    // Cross-screen: navigate then wait
    if (typeof showScreen === 'function') showScreen(targetScreen);
    _t.currentScreen = targetScreen;
    // Run teardown on the step we're leaving
    var leaving = _t.steps[nextIdx - 1] || _t.steps[nextIdx];
    if (leaving && typeof leaving.teardown === 'function') leaving.teardown();
    setTimeout(function () {
      if (tt) tt.classList.remove('t-tip-exit');
      _tourPositionStep(nextIdx);
    }, 420);
  } else {
    // Same screen: start panels moving immediately
    if (typeof s.prep === 'function') s.prep();
    var el = _tourFindEl(s.target);
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      requestAnimationFrame(function () {
        var rect = el.getBoundingClientRect();
        var pad  = 10;
        el.setAttribute('data-tour-active', '');
        _t.prevTarget = el;
        var root = document.getElementById('tour-root');
        if (root) root.style.setProperty('--t-accent', s.color);
        _movePanels(rect, pad);
        _moveRing(rect, pad, s.color);
        setTimeout(function () {
          if (tt) tt.classList.remove('t-tip-exit');
          _fillTooltip(s, rect, pad, nextIdx);
        }, 60);
      });
    } else {
      setTimeout(function () {
        if (tt) tt.classList.remove('t-tip-exit');
        _tourRender(nextIdx);
      }, 120);
    }
  }
}


/* ══════════════════════════════════════════════════════════════
   DOM BUILD
══════════════════════════════════════════════════════════════ */
function _tourBuildDOM() {
  var old = document.getElementById('tour-root');
  if (old) old.remove();
  var r  = document.createElement('div');
  r.id   = 'tour-root';
  r.className = 'tour-root';
  r.innerHTML =
      '<div class="t-panel" id="tp-top"></div>'
    + '<div class="t-panel" id="tp-bot"></div>'
    + '<div class="t-panel" id="tp-lft"></div>'
    + '<div class="t-panel" id="tp-rgt"></div>'
    + '<div class="t-ring"  id="t-ring"></div>'
    + '<div class="t-tip"   id="t-tip">'
    +   '<div class="t-tip-top">'
    +     '<div class="t-tip-left">'
    +       '<div class="t-tip-progress" id="t-progress"></div>'
    +       '<span class="t-step-count" id="t-step-count"></span>'
    +     '</div>'
    +     '<button class="t-skip" onclick="tourSkip()">Skip tour</button>'
    +   '</div>'
    +   '<span class="t-emoji" id="t-emoji"></span>'
    +   '<div class="t-title" id="t-title"></div>'
    +   '<div class="t-body"  id="t-body"></div>'
    +   '<div class="t-footer">'
    +     '<button class="t-btn-back" id="t-back" onclick="_tourPrev()">← Back</button>'
    +     '<button class="t-btn-next" id="t-next" onclick="_tourNext()">Next →</button>'
    +   '</div>'
    + '</div>'
    + '<div class="t-finish hidden" id="t-finish">'
    +   '<div class="t-finish-card">'
    +     '<div class="t-confetti-wrap" id="t-confetti"></div>'
    +     '<div class="t-finish-emoji">🎉</div>'
    +     '<div class="t-finish-h">You\'re all set!</div>'
    +     '<div class="t-finish-p">Everything you need to ace HOSA is right here.<br>Start your first streak today — and check the Weekly League.</div>'
    +     '<button class="t-finish-btn" onclick="tourDone()">Let\'s go →</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(r);
  window.addEventListener('resize', _tourOnResize);
}


/* ══════════════════════════════════════════════════════════════
   TOOLTIP CONTENT + PLACEMENT
══════════════════════════════════════════════════════════════ */
function _fillTooltip(s, rect, pad, idx) {
  var total = _t.steps.length;
  var tt    = document.getElementById('t-tip');
  var next  = document.getElementById('t-next');
  var back  = document.getElementById('t-back');
  var em    = document.getElementById('t-emoji');

  // Dot progress bar
  var dots = '';
  for (var i = 0; i < total; i++) {
    dots += '<div class="t-dot ' + (i < idx ? 'done' : i === idx ? 'active' : '') + '"></div>';
  }
  document.getElementById('t-progress').innerHTML    = dots;
  document.getElementById('t-step-count').textContent = (idx + 1) + ' / ' + total;

  em.textContent                           = s.emoji;
  document.getElementById('t-title').textContent = s.title;
  document.getElementById('t-body').textContent  = s.body;

  next.textContent      = idx === total - 1 ? 'Finish 🎉' : 'Next →';
  next.style.background = s.color;
  back.style.visibility = idx === 0 ? 'hidden' : 'visible';

  tt.classList.remove('t-tip-enter');
  void tt.offsetWidth;
  tt.classList.add('t-tip-enter');

  em.classList.remove('t-emoji-pop');
  void em.offsetWidth;
  em.classList.add('t-emoji-pop');

  _placeTooltip(rect, s.pos, pad);
}

function _placeTooltip(rect, pos, pad) {
  var tt  = document.getElementById('t-tip');
  var W   = window.innerWidth;
  var H   = window.innerHeight;
  var ttW = W < 520 ? W - 28 : 320;
  var ttH = tt.offsetHeight || 240;
  var mar = 14;

  tt.style.width = ttW + 'px';

  var left  = Math.max(14, Math.min(rect.left + rect.width / 2 - ttW / 2, W - ttW - 14));
  var below = (pos === 'bottom')
    || (pos !== 'top' && (H - rect.bottom - pad - mar) >= ttH)
    || (rect.top - pad - mar) < ttH;
  var top   = Math.max(10, Math.min(
    below ? rect.bottom + pad + mar : rect.top - pad - mar - ttH,
    H - ttH - 10
  ));

  tt.setAttribute('data-arrow', below ? 'up' : 'down');

  if (W < 520) {
    tt.style.left   = '10px';
    tt.style.bottom = '14px';
    tt.style.top    = 'auto';
    tt.setAttribute('data-arrow', 'none');
  } else {
    tt.style.left   = left + 'px';
    tt.style.top    = top  + 'px';
    tt.style.bottom = 'auto';
  }
}


/* ══════════════════════════════════════════════════════════════
   FINISH SCREEN
══════════════════════════════════════════════════════════════ */
function _tourShowFinish() {
  var cur = _t.steps[_t.step];
  if (cur && typeof cur.teardown === 'function') cur.teardown();
  if (_t.prevTarget) { _t.prevTarget.removeAttribute('data-tour-active'); _t.prevTarget = null; }

  var rg = document.getElementById('t-ring');
  var tt = document.getElementById('t-tip');
  if (rg) rg.style.opacity = '0';
  if (tt) tt.classList.add('t-tip-exit');
  _closePanels();

  setTimeout(function () {
    var fin = document.getElementById('t-finish');
    if (fin) fin.classList.remove('hidden');
    setTimeout(_launchConfetti, 320);
  }, 360);
}

function _launchConfetti() {
  var stage = document.getElementById('t-confetti');
  if (!stage) return;
  var colors = ['#0d9488','#d97706','#7c3aed','#ec4899','#f59e0b','#3b82f6','#10b981','#ef4444','#f97316','#8b5cf6'];
  var shapes = ['50%', '2px', '3px', '50%', '0'];
  var html   = '';
  for (var i = 0; i < 64; i++) {
    var c  = colors[i % colors.length];
    var dx = (Math.random() * 300 - 150).toFixed(1);
    var dy = -(Math.random() * 260 + 80).toFixed(1);
    var rt = (Math.random() * 720 - 360).toFixed(1);
    var dl = (Math.random() * 0.38).toFixed(2);
    var w  = (Math.random() * 11 + 4).toFixed(1);
    var h2 = (Math.random() * 7  + 3).toFixed(1);
    var br = shapes[i % shapes.length];
    html += '<div class="t-conf" style="--c:' + c + ';--dx:' + dx + 'px;--dy:' + dy + 'px;--r:' + rt + 'deg;--d:' + dl + 's;width:' + w + 'px;height:' + h2 + 'px;border-radius:' + br + ';' + (br === '0' ? 'transform:rotate(45deg);' : '') + '"></div>';
  }
  stage.innerHTML = html;
}


/* ══════════════════════════════════════════════════════════════
   TEARDOWN
══════════════════════════════════════════════════════════════ */
function _tourEnd() {
  var cur = _t.steps[_t.step];
  if (cur && typeof cur.teardown === 'function') cur.teardown();
  if (_t.prevTarget) { _t.prevTarget.removeAttribute('data-tour-active'); _t.prevTarget = null; }

  var root = document.getElementById('tour-root');
  if (!root) return;

  try { localStorage.setItem(TOUR_KEY, '1'); } catch(e) {}
  _t.active = false;
  window.removeEventListener('resize', _tourOnResize);

  root.classList.add('t-root-exit');
  setTimeout(function () { if (root.parentNode) root.remove(); }, 360);

  // Return user to home screen
  setTimeout(function () {
    if (typeof showScreen === 'function') showScreen('home');
  }, 400);
}


/* ══════════════════════════════════════════════════════════════
   RESIZE HANDLER — re-measures instantly (no scroll needed since
   the element is already on screen)
══════════════════════════════════════════════════════════════ */
function _tourOnResize() {
  clearTimeout(_tourResizeTimer);
  _tourResizeTimer = setTimeout(function () {
    if (!_t.active) return;
    var s  = _t.steps[_t.step];
    if (!s) return;
    var el = _tourFindEl(s.target);
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var pad  = 10;
    _movePanels(rect, pad);
    _moveRing(rect, pad, s.color);
    _placeTooltip(rect, s.pos, pad);
  }, 60);
}
