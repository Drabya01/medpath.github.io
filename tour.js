/* ══════════════════════════════════════════
   MedPath — Premium Feature Tour
   Runs once after onboarding completes.
   Spotlight + spring animation system.
══════════════════════════════════════════ */

var TOUR_KEY = 'medpath_tour_v1';
var _tourResizeTimer;
var _t = { step: 0, active: false, profile: null, steps: [] };

/* ── Step definitions ─────────────────── */
var _TOUR_STEPS = [
  {
    id: 'flashcards',
    target: '.mc--flash',
    emoji: '🃏',
    color: '#0d9488',
    title: 'Flashcards — your core tool',
    body: '7,000+ medical cards powered by SM-2 spaced repetition — the same algorithm used by medical students worldwide. Each card comes back exactly when your brain is about to forget it.',
    pos: 'bottom',
  },
  {
    id: 'case',
    target: '.mc--case',
    emoji: '🏥',
    color: '#0284c7',
    title: 'Think like a clinician',
    body: 'Real patient presentations with full history, exam, diagnosis, and treatment. This is how HOSA cases are structured — practice here, ace it there.',
    pos: 'bottom',
  },
  {
    id: 'anatomy',
    target: '.mc--anatomy',
    emoji: '🫀',
    color: '#dc2626',
    title: 'Interactive Anatomy',
    body: 'Explore every body system visually. Tap any region to study its functions, landmarks, and clinical relevance — all in one place.',
    pos: 'bottom',
  },
  {
    id: 'quiz',
    target: '.mc--quiz',
    emoji: '📝',
    color: '#7c3aed',
    title: 'Quiz Mode — exam-ready',
    body: 'Timed multiple choice in real HOSA exam format. Your accuracy per category is tracked so you always know where to focus next.',
    pos: 'bottom',
  },
  {
    id: 'hosa',
    target: '.mc--hosa',
    emoji: '🏆',
    color: '#d97706',
    title: 'HOSA Events hub',
    body: 'Every competitive event, scoring rubric, and practice resource for HOSA Canada — organised by event and always up to date.',
    pos: 'bottom',
  },
  {
    id: 'progress',
    target: '.mc--progress',
    emoji: '📈',
    color: '#059669',
    title: 'Track everything',
    body: 'XP, streaks, mastery ratings, weak spots. See exactly what you\'ve learned and what needs another pass before competition day.',
    pos: 'auto',
  },
  {
    id: 'club',
    target: '.mc--club',
    emoji: '🏫',
    color: '#0d9488',
    title: 'Club Dashboard',
    body: 'Create or join a study club. Teachers can assign targeted practice; students can see their class rank and complete assignments.',
    pos: 'top',
  },
];

/* ── Public entry ─────────────────────── */

function tourStart(profile) {
  try { if (localStorage.getItem(TOUR_KEY)) return; } catch(e) {}
  // Brief delay so the home screen finishes rendering
  setTimeout(function() {
    // Make sure we're on the home screen
    var home = document.getElementById('screen-home');
    if (!home || !home.classList.contains('active')) {
      document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
      if (home) home.classList.add('active');
    }
    _t.profile = profile || {};
    _t.step    = 0;
    _t.active  = true;
    // Only include steps whose target exists in DOM
    _t.steps   = _TOUR_STEPS.filter(function(s) { return !!document.querySelector(s.target); });
    _tourBuildDOM();
    // Stagger: backdrop fades in first, then step renders
    setTimeout(function() { _tourRender(0); }, 220);
  }, 800);
}

function tourSkip()  { _tourEnd(); }
function tourDone()  { _tourEnd(); }
function _tourNext() {
  _t.step++;
  if (_t.step >= _t.steps.length) { _tourShowFinish(); return; }
  _tourRender(_t.step);
}
function _tourPrev() {
  if (_t.step > 0) { _t.step--; _tourRender(_t.step); }
}

/* ── DOM builder ──────────────────────── */

function _tourBuildDOM() {
  var old = document.getElementById('tour-root');
  if (old) old.remove();
  var r = document.createElement('div');
  r.id = 'tour-root';
  r.className = 'tour-root';
  r.innerHTML =
    /* 4 backdrop panels */
    '<div class="t-panel" id="tp-top"></div>'
   +'<div class="t-panel" id="tp-bot"></div>'
   +'<div class="t-panel" id="tp-lft"></div>'
   +'<div class="t-panel" id="tp-rgt"></div>'
   /* spotlight ring */
   +'<div class="t-ring" id="t-ring"></div>'
   /* tooltip card */
   +'<div class="t-tip" id="t-tip">'
   +  '<div class="t-tip-top">'
   +    '<div class="t-tip-progress" id="t-progress"></div>'
   +    '<button class="t-skip" onclick="tourSkip()">Skip tour</button>'
   +  '</div>'
   +  '<span class="t-emoji" id="t-emoji"></span>'
   +  '<div class="t-title" id="t-title"></div>'
   +  '<div class="t-body"  id="t-body"></div>'
   +  '<div class="t-footer">'
   +    '<button class="t-btn-back" id="t-back" onclick="_tourPrev()">← Back</button>'
   +    '<button class="t-btn-next" id="t-next" onclick="_tourNext()">Next →</button>'
   +  '</div>'
   +'</div>'
   /* finish celebration */
   +'<div class="t-finish hidden" id="t-finish">'
   +  '<div class="t-finish-card" id="t-fc">'
   +    '<div class="t-confetti-wrap" id="t-confetti"></div>'
   +    '<div class="t-finish-emoji">🎉</div>'
   +    '<div class="t-finish-h">You\'re all set!</div>'
   +    '<div class="t-finish-p">Everything you need to ace HOSA is right here. Build your first streak today.</div>'
   +    '<button class="t-finish-btn" onclick="tourDone()">Let\'s go  →</button>'
   +  '</div>'
   +'</div>';
  document.body.appendChild(r);

  // Initialise panel sizes to 0px so CSS transitions have a concrete
  // start value — height/width:auto cannot be transitioned
  document.getElementById('tp-top').style.height = '0px';
  document.getElementById('tp-bot').style.height = '0px';
  ['tp-lft','tp-rgt'].forEach(function(id) {
    var el = document.getElementById(id);
    el.style.width  = '0px';
    el.style.height = '0px';
  });

  window.addEventListener('resize', _tourOnResize);
}

/* ── Render a step ────────────────────── */

function _tourRender(idx) {
  var s  = _t.steps[idx];
  if (!s) { _tourShowFinish(); return; }
  var el = document.querySelector(s.target);
  if (!el) { _t.step++; _tourRender(_t.step); return; }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Tiny delay so scroll settles before we measure
  setTimeout(function() {
    var rect = el.getBoundingClientRect();
    var pad  = 11;
    _movePanels(rect, pad);
    _moveRing(rect, pad, s.color);
    _fillTooltip(s, rect, pad, idx);
  }, 90);
}

/* ── Panel positions ──────────────────── */

function _movePanels(rect, pad) {
  var W = window.innerWidth, H = window.innerHeight;
  var t = Math.max(0, rect.top    - pad);
  var b = Math.max(0, H - rect.bottom - pad);
  var l = Math.max(0, rect.left   - pad);
  var rr = Math.max(0, W - rect.right  - pad);
  var sh  = Math.max(0, rect.height + 2 * pad);

  var tp = document.getElementById('tp-top'),
      bp = document.getElementById('tp-bot'),
      lp = document.getElementById('tp-lft'),
      rp = document.getElementById('tp-rgt');

  tp.style.height = t  + 'px';
  bp.style.height = b  + 'px';
  lp.style.top    = t  + 'px';  lp.style.height = sh + 'px'; lp.style.width = l  + 'px';
  rp.style.top    = t  + 'px';  rp.style.height = sh + 'px'; rp.style.width = rr + 'px';
}

function _moveRing(rect, pad, color) {
  var rg = document.getElementById('t-ring');
  rg.style.left        = (rect.left   - pad)     + 'px';
  rg.style.top         = (rect.top    - pad)      + 'px';
  rg.style.width       = (rect.width  + 2 * pad)  + 'px';
  rg.style.height      = (rect.height + 2 * pad)  + 'px';
  rg.style.borderColor = color;
  rg.style.boxShadow   = '0 0 0 4px ' + color + '28, 0 0 28px ' + color + '30';
  rg.style.opacity     = '1';
}

/* ── Fill tooltip content ─────────────── */

function _fillTooltip(s, rect, pad, idx) {
  var total = _t.steps.length;
  var tt    = document.getElementById('t-tip');
  var next  = document.getElementById('t-next');
  var back  = document.getElementById('t-back');
  var em    = document.getElementById('t-emoji');

  // Progress dots
  var dots = '';
  for (var i = 0; i < total; i++) {
    var cls = i < idx ? 'done' : i === idx ? 'active' : '';
    dots += '<div class="t-dot ' + cls + '"></div>';
  }
  document.getElementById('t-progress').innerHTML = dots;

  // Content
  em.textContent  = s.emoji;
  document.getElementById('t-title').textContent = s.title;
  document.getElementById('t-body').textContent  = s.body;

  next.textContent         = idx === total - 1 ? 'Finish  🎉' : 'Next  →';
  next.style.background    = s.color;
  back.style.visibility    = idx === 0 ? 'hidden' : 'visible';

  // Animate in
  tt.classList.remove('t-tip-enter');
  void tt.offsetWidth; // reflow
  tt.classList.add('t-tip-enter');

  em.classList.remove('t-emoji-pop');
  void em.offsetWidth;
  em.classList.add('t-emoji-pop');

  // Place tooltip
  _placeTooltip(rect, s.pos, pad);
}

/* ── Tooltip placement ────────────────── */

function _placeTooltip(rect, pos, pad) {
  var tt  = document.getElementById('t-tip');
  var W   = window.innerWidth, H = window.innerHeight;
  var ttW = W < 520 ? W - 32 : 300;
  var ttH = tt.offsetHeight || 220;
  var mar = 16;

  tt.style.width = ttW + 'px';

  var left = rect.left + rect.width / 2 - ttW / 2;
  left = Math.max(16, Math.min(left, W - ttW - 16));

  var below = (pos === 'bottom')
    || (pos !== 'top' && (H - rect.bottom - pad - mar) >= ttH)
    || (rect.top - pad - mar) < ttH;
  var top   = below
    ? rect.bottom + pad + mar
    : rect.top - pad - mar - ttH;
  top = Math.max(12, Math.min(top, H - ttH - 12));

  tt.setAttribute('data-arrow', below ? 'up' : 'down');

  // On narrow mobile: pin to bottom
  if (W < 520) {
    tt.style.left   = '16px';
    tt.style.bottom = '20px';
    tt.style.top    = 'auto';
    tt.setAttribute('data-arrow', 'none');
  } else {
    tt.style.left   = left + 'px';
    tt.style.top    = top  + 'px';
    tt.style.bottom = 'auto';
  }
}

/* ── Finish celebration ───────────────── */

function _tourShowFinish() {
  // Hide panels & tooltip
  ['tp-top','tp-bot','tp-lft','tp-rgt'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
  });
  var rg = document.getElementById('t-ring');
  var tt = document.getElementById('t-tip');
  if (rg) rg.style.opacity = '0';
  if (tt) tt.style.opacity = '0';

  var fin = document.getElementById('t-finish');
  fin.classList.remove('hidden');
  setTimeout(_launchConfetti, 350);
}

function _launchConfetti() {
  var stage  = document.getElementById('t-confetti');
  if (!stage) return;
  var colors = ['#0d9488','#d97706','#7c3aed','#ec4899','#f59e0b','#3b82f6','#10b981','#ef4444','#f97316'];
  var html   = '';
  for (var i = 0; i < 56; i++) {
    var c   = colors[i % colors.length];
    var dx  = (Math.random() * 280 - 140).toFixed(1);
    var dy  = -(Math.random() * 240 + 80).toFixed(1);
    var rot = (Math.random() * 720 - 360).toFixed(1);
    var del = (Math.random() * 0.35).toFixed(2);
    var w   = (Math.random() * 10 + 4).toFixed(1);
    var h2  = (Math.random() * 7  + 3).toFixed(1);
    var br  = Math.random() > 0.45 ? '50%' : '2px';
    html += '<div class="t-conf" style="'
      + '--c:'  + c          + ';'
      + '--dx:' + dx         + 'px;'
      + '--dy:' + dy         + 'px;'
      + '--r:'  + rot        + 'deg;'
      + '--d:'  + del        + 's;'
      + 'width:' + w         + 'px;'
      + 'height:' + h2       + 'px;'
      + 'border-radius:' + br
      + '"></div>';
  }
  stage.innerHTML = html;
}

/* ── Teardown ─────────────────────────── */

function _tourEnd() {
  var root = document.getElementById('tour-root');
  if (!root) return;
  try { localStorage.setItem(TOUR_KEY, '1'); } catch(e) {}
  _t.active = false;
  window.removeEventListener('resize', _tourOnResize);
  root.classList.add('t-exit');
  setTimeout(function() { if (root.parentNode) root.remove(); }, 480);
}

function _tourOnResize() {
  clearTimeout(_tourResizeTimer);
  _tourResizeTimer = setTimeout(function() {
    if (!_t.active) return;
    var s  = _t.steps[_t.step];
    if (!s) return;
    var el = document.querySelector(s.target);
    if (!el) return;
    var rect = el.getBoundingClientRect();
    _movePanels(rect, 11);
    _moveRing(rect, 11, s.color);
    _placeTooltip(rect, s.pos, 11);
  }, 80);
}
