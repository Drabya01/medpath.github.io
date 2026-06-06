/* ══════════════════════════════════════════
   MedPath — Feature Tour  v3
   Single-overlay clip-path spotlight.
   Spring morphing · iris open · heartbeat.
══════════════════════════════════════════ */

var TOUR_KEY = 'medpath_tour_v1';
var _tourResizeTimer;
var _t = { step:0, active:false, profile:null, steps:[], prevTarget:null };

/* ── Steps ────────────────────────────── */
var _TOUR_STEPS = [
  {
    id:'flashcards', target:'.mc--flash', emoji:'🃏', color:'#0d9488',
    title:'Flashcards — your core tool',
    body:'7,000+ medical cards with SM-2 spaced repetition. Each card comes back exactly when your brain is about to forget it — smarter than re-reading.',
    pos:'bottom',
  },
  {
    id:'case', target:'.mc--case', emoji:'🏥', color:'#0284c7',
    title:'Think like a clinician',
    body:'Real patient presentations with full history, exam, diagnosis, and management. Build genuine clinical reasoning — not just surface recall.',
    pos:'bottom',
  },
  {
    id:'anatomy', target:'.mc--anatomy', emoji:'🫀', color:'#dc2626',
    title:'Interactive Anatomy',
    body:'Explore every body system visually. Tap any region to study its functions, landmarks, and clinical relevance — everything connected.',
    pos:'bottom',
  },
  {
    id:'quiz', target:'.mc--quiz', emoji:'📝', color:'#7c3aed',
    title:'Quiz Mode — test yourself',
    body:'Timed multiple choice mirroring real exam conditions. Accuracy tracked per category so you always know exactly where to focus next.',
    pos:'bottom',
  },
  {
    id:'hosa', target:'.mc--hosa', emoji:'🏆', color:'#d97706',
    title:'Competitive Events',
    body:'Every event, study guide, scoring rubric, and practice resource — organised by event and always current. Everything in one place.',
    pos:'bottom',
  },
  {
    id:'progress', target:'.mc--progress', emoji:'📈', color:'#059669',
    title:'Track your growth',
    body:'XP, streaks, mastery ratings, and weak spots. See exactly what you\'ve learned and what still needs work — nothing slips through.',
    pos:'auto',
  },
  {
    id:'club', target:'.mc--club', emoji:'🏫', color:'#0d9488',
    title:'Club Dashboard',
    body:'Create or join a study group. Assign targeted practice, track the whole class, and see who needs help with what.',
    pos:'top',
  },
];

/* ── Helpers ──────────────────────────── */

/** Build a clip-path string: full-screen overlay with a rectangular hole.
 *  Outer path CW in screen space, inner path CCW → nonzero rule = hole. */
function _buildClipPath(x1, y1, x2, y2) {
  return 'path("M -1 -1 L 9999 -1 L 9999 9999 L -1 9999 Z M '
    + x1 + ' ' + y1 + ' L '
    + x1 + ' ' + y2 + ' L '
    + x2 + ' ' + y2 + ' L '
    + x2 + ' ' + y1 + ' Z")';
}

/** Set overlay clip-path. Pass skipTransition=true to jump instantly. */
function _setOverlay(x1, y1, x2, y2, skipTransition) {
  var ov = document.getElementById('t-overlay');
  if (!ov) return;
  if (skipTransition) {
    ov.style.transition = 'none';
    ov.style.clipPath = _buildClipPath(x1, y1, x2, y2);
    // Re-enable transition after a paint
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        ov.style.transition = '';
      });
    });
  } else {
    ov.style.clipPath = _buildClipPath(x1, y1, x2, y2);
  }
}

/* ── Public API ───────────────────────── */

function tourStart(profile) {
  try { if (localStorage.getItem(TOUR_KEY)) return; } catch(e) {}
  setTimeout(function() {
    var home = document.getElementById('screen-home');
    if (!home || !home.classList.contains('active')) {
      document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
      if (home) home.classList.add('active');
    }
    _t.profile = profile || {}; _t.step = 0; _t.active = true; _t.prevTarget = null;
    _t.steps = _TOUR_STEPS.filter(function(s){ return !!document.querySelector(s.target); });
    _tourBuildDOM();
    setTimeout(function(){ _tourRender(0, true); }, 260);
  }, 800);
}

function tourSkip() { _tourEnd(); }
function tourDone() { _tourEnd(); }

function _tourNext() {
  _t.step++;
  if (_t.step >= _t.steps.length) { _tourShowFinish(); return; }
  _tourTransitionTo(_t.step);
}
function _tourPrev() {
  if (_t.step > 0) { _t.step--; _tourTransitionTo(_t.step); }
}

/* ── DOM ──────────────────────────────── */

function _tourBuildDOM() {
  var old = document.getElementById('tour-root');
  if (old) old.remove();
  var r = document.createElement('div');
  r.id = 'tour-root'; r.className = 'tour-root';
  r.innerHTML =
    /* Single overlay — clip-path punches the spotlight hole */
    '<div class="t-overlay" id="t-overlay"></div>'
   /* Ring sits at z-index above overlay, outlines the hole */
   +'<div class="t-ring" id="t-ring"></div>'
   +'<div class="t-tip" id="t-tip">'
   +  '<div class="t-tip-top">'
   +    '<div class="t-tip-left">'
   +      '<div class="t-tip-progress" id="t-progress"></div>'
   +      '<span class="t-step-count" id="t-step-count"></span>'
   +    '</div>'
   +    '<button class="t-skip" onclick="tourSkip()">Skip</button>'
   +  '</div>'
   +  '<span class="t-emoji" id="t-emoji"></span>'
   +  '<div class="t-title" id="t-title"></div>'
   +  '<div class="t-body"  id="t-body"></div>'
   +  '<div class="t-footer">'
   +    '<button class="t-btn-back" id="t-back" onclick="_tourPrev()">← Back</button>'
   +    '<button class="t-btn-next" id="t-next" onclick="_tourNext()">Next →</button>'
   +  '</div>'
   +'</div>'
   +'<div class="t-finish hidden" id="t-finish">'
   +  '<div class="t-finish-card">'
   +    '<div class="t-confetti-wrap" id="t-confetti"></div>'
   +    '<div class="t-finish-emoji">🎉</div>'
   +    '<div class="t-finish-h">You\'re all set!</div>'
   +    '<div class="t-finish-p">Everything you need to learn healthcare is right here.<br>Start your first streak today.</div>'
   +    '<button class="t-finish-btn" onclick="tourDone()">Let\'s go →</button>'
   +  '</div>'
   +'</div>';
  document.body.appendChild(r);
  window.addEventListener('resize', _tourOnResize);
}

/* ── Render step ──────────────────────── */

function _tourRender(idx, isFirst) {
  var s = _t.steps[idx];
  if (!s) { _tourShowFinish(); return; }
  var el = document.querySelector(s.target);
  if (!el) { _t.step++; _tourRender(_t.step); return; }

  /* Swap highlight */
  if (_t.prevTarget && _t.prevTarget !== el) _t.prevTarget.removeAttribute('data-tour-active');
  el.setAttribute('data-tour-active', '');
  _t.prevTarget = el;

  /* Update accent color CSS variable */
  var root = document.getElementById('tour-root');
  if (root) root.style.setProperty('--t-accent', s.color);

  el.scrollIntoView({ behavior:'smooth', block:'center' });

  setTimeout(function() {
    var rect = el.getBoundingClientRect(), pad = 13;
    var x1 = Math.round(rect.left - pad), y1 = Math.round(rect.top - pad);
    var x2 = Math.round(rect.right + pad), y2 = Math.round(rect.bottom + pad);

    if (isFirst) {
      /* Iris open: start with a 1px dot at element center, then spring open */
      var cx = Math.round((rect.left + rect.right) / 2);
      var cy = Math.round((rect.top  + rect.bottom) / 2);
      _setOverlay(cx, cy, cx+1, cy+1, true);   /* instant seed */
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          _setOverlay(x1, y1, x2, y2, false);  /* spring open */
        });
      });
    } else {
      _setOverlay(x1, y1, x2, y2, false);      /* spring morph */
    }

    _moveRing(rect, pad, s.color);
    _fillTooltip(s, rect, pad, idx);
  }, 95);
}

/* ── Between-step transition ──────────── */

function _tourTransitionTo(nextIdx) {
  var tt = document.getElementById('t-tip');
  var rg = document.getElementById('t-ring');
  /* Exit current state */
  if (tt) tt.classList.add('t-tip-exit');
  if (rg) rg.style.opacity = '0.1';
  if (_t.prevTarget) { _t.prevTarget.removeAttribute('data-tour-active'); _t.prevTarget = null; }
  /* Small delay then render next (overlay starts morphing immediately) */
  setTimeout(function() {
    if (tt) tt.classList.remove('t-tip-exit');
    _tourRender(nextIdx, false);
  }, 200);
}

/* ── Ring ─────────────────────────────── */

function _moveRing(rect, pad, color) {
  var rg = document.getElementById('t-ring');
  if (!rg) return;
  rg.style.left        = (rect.left   - pad) + 'px';
  rg.style.top         = (rect.top    - pad) + 'px';
  rg.style.width       = (rect.width  + 2*pad) + 'px';
  rg.style.height      = (rect.height + 2*pad) + 'px';
  rg.style.borderColor = color;
  rg.style.color       = color; /* for ::before pseudo-element */
  rg.style.opacity     = '1';
}

/* ── Tooltip content ──────────────────── */

function _fillTooltip(s, rect, pad, idx) {
  var total = _t.steps.length;
  var tt = document.getElementById('t-tip'), next = document.getElementById('t-next'),
      back = document.getElementById('t-back'), em = document.getElementById('t-emoji');

  var dots = '';
  for (var i = 0; i < total; i++)
    dots += '<div class="t-dot ' + (i < idx ? 'done' : i === idx ? 'active' : '') + '"></div>';
  document.getElementById('t-progress').innerHTML = dots;
  document.getElementById('t-step-count').textContent = (idx+1) + ' / ' + total;

  em.textContent = s.emoji;
  document.getElementById('t-title').textContent = s.title;
  document.getElementById('t-body').textContent  = s.body;
  next.textContent      = idx === total-1 ? 'Finish  🎉' : 'Next  →';
  next.style.background = s.color;
  back.style.visibility = idx === 0 ? 'hidden' : 'visible';

  tt.classList.remove('t-tip-enter');  void tt.offsetWidth;  tt.classList.add('t-tip-enter');
  em.classList.remove('t-emoji-pop');  void em.offsetWidth;  em.classList.add('t-emoji-pop');

  _placeTooltip(rect, s.pos, pad);
}

/* ── Tooltip placement ────────────────── */

function _placeTooltip(rect, pos, pad) {
  var tt = document.getElementById('t-tip');
  var W = window.innerWidth, H = window.innerHeight;
  var ttW = W < 520 ? W - 32 : 308, ttH = tt.offsetHeight || 235, mar = 16;
  tt.style.width = ttW + 'px';
  var left = Math.max(16, Math.min(rect.left + rect.width/2 - ttW/2, W - ttW - 16));
  var below = (pos === 'bottom') || (pos !== 'top' && (H - rect.bottom - pad - mar) >= ttH) || (rect.top - pad - mar) < ttH;
  var top = Math.max(12, Math.min(below ? rect.bottom+pad+mar : rect.top-pad-mar-ttH, H-ttH-12));
  tt.setAttribute('data-arrow', below ? 'up' : 'down');
  if (W < 520) { tt.style.left='16px'; tt.style.bottom='18px'; tt.style.top='auto'; tt.setAttribute('data-arrow','none'); }
  else         { tt.style.left=left+'px'; tt.style.top=top+'px'; tt.style.bottom='auto'; }
}

/* ── Finish ───────────────────────────── */

function _tourShowFinish() {
  if (_t.prevTarget) { _t.prevTarget.removeAttribute('data-tour-active'); _t.prevTarget = null; }
  var ov = document.getElementById('t-overlay');
  var rg = document.getElementById('t-ring');
  var tt = document.getElementById('t-tip');
  /* Collapse the spotlight hole back to nothing */
  if (ov) {
    var cx = Math.round(window.innerWidth / 2), cy = Math.round(window.innerHeight / 2);
    _setOverlay(cx, cy, cx+1, cy+1, false); /* iris close */
    setTimeout(function() { if (ov) ov.style.opacity = '0'; }, 560);
  }
  if (rg) rg.style.opacity = '0';
  if (tt) tt.classList.add('t-tip-exit');
  setTimeout(function() {
    document.getElementById('t-finish').classList.remove('hidden');
    setTimeout(_launchConfetti, 400);
  }, 400);
}

function _launchConfetti() {
  var stage = document.getElementById('t-confetti'); if (!stage) return;
  var colors = ['#0d9488','#d97706','#7c3aed','#ec4899','#f59e0b','#3b82f6','#10b981','#ef4444','#f97316','#8b5cf6'];
  var shapes = ['50%','2px','3px','50%','0'];
  var html = '';
  for (var i = 0; i < 70; i++) {
    var c=colors[i%colors.length], dx=(Math.random()*340-170).toFixed(1);
    var dy=-(Math.random()*280+80).toFixed(1), rot=(Math.random()*800-400).toFixed(1);
    var del=(Math.random()*0.45).toFixed(2), w=(Math.random()*12+4).toFixed(1);
    var h2=(Math.random()*7+3).toFixed(1), br=shapes[i%shapes.length];
    html += '<div class="t-conf" style="--c:'+c+';--dx:'+dx+'px;--dy:'+dy+'px;--r:'+rot+'deg;--d:'+del+'s;width:'+w+'px;height:'+h2+'px;border-radius:'+br+';'+(br==='0'?'transform:rotate(45deg);':'')+'"></div>';
  }
  stage.innerHTML = html;
}

/* ── Teardown ─────────────────────────── */

function _tourEnd() {
  if (_t.prevTarget) { _t.prevTarget.removeAttribute('data-tour-active'); _t.prevTarget = null; }
  var root = document.getElementById('tour-root'); if (!root) return;
  try { localStorage.setItem(TOUR_KEY,'1'); } catch(e) {}
  _t.active = false;
  window.removeEventListener('resize', _tourOnResize);
  root.classList.add('t-root-exit');
  setTimeout(function() { if (root.parentNode) root.remove(); }, 440);
}

function _tourOnResize() {
  clearTimeout(_tourResizeTimer);
  _tourResizeTimer = setTimeout(function() {
    if (!_t.active) return;
    var s = _t.steps[_t.step]; if (!s) return;
    var el = document.querySelector(s.target); if (!el) return;
    var rect = el.getBoundingClientRect(), pad = 13;
    _setOverlay(Math.round(rect.left-pad), Math.round(rect.top-pad), Math.round(rect.right+pad), Math.round(rect.bottom+pad), true);
    _moveRing(rect, pad, s.color);
    _placeTooltip(rect, s.pos, pad);
  }, 80);
}
