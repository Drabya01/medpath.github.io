/* ═══════════════════════════════════════════════════════════════
   MedPath — Study Modes  v1
   Load AFTER script.js.

   1. Interleaved "Mixed Mode"
      Pulls cards from the 3 weakest categories and shuffles them
      in an interleaved ABCABC pattern. Science shows this beats
      blocked practice for long-term retention.

   2. Feynman Voice Mode
      Before flipping a card, the student explains the concept
      aloud using the microphone. The Web Speech API transcribes
      it in real time. After flipping, they self-assess how accurate
      their explanation was — which maps to SM-2 ratings.
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. INTERLEAVED MIXED MODE
═══════════════════════════════════════════════════════════════ */

var _mixedActive = false;

/**
 * Compute the N weakest categories from SM-2 data.
 * "Weakest" = most cards that are new, overdue, or have low ease.
 * Returns an array of category name strings.
 */
function _getWeakestCategories(n) {
  if (typeof flashcards === 'undefined' || typeof sm2Get === 'undefined') return [];
  n = n || 3;
  var now = Date.now();
  var scores = {};

  flashcards.forEach(function(f) {
    if (!f.cat || f.cat === 'All' || f.cat === 'Saved ⭐') return;
    var c = sm2Get('fc:' + f.term);
    if (!scores[f.cat]) scores[f.cat] = { weight: 0, total: 0 };
    scores[f.cat].total++;
    // Weight: new cards = 3, overdue = 2, low ease = 1
    if (c.state === 'new')                   scores[f.cat].weight += 3;
    else if (c.due <= now)                   scores[f.cat].weight += 2;
    else if ((c.ease || 2.5) < 2.2)         scores[f.cat].weight += 1;
    if (c.lapses > 2)                        scores[f.cat].weight += 1;
  });

  return Object.entries(scores)
    .filter(function(e) { return e[1].total >= 3; })
    .sort(function(a, b) { return b[1].weight - a[1].weight; })
    .slice(0, n)
    .map(function(e) { return e[0]; });
}

/**
 * Build an interleaved deck from the given categories.
 * Pattern: [A0, B0, C0, A1, B1, C1, ...]  (round-robin)
 * Each bucket respects SM-2: overdue first, then learning, then new.
 */
function _buildInterleavedDeck(cats) {
  var now     = Date.now();
  var buckets = cats.map(function(cat) {
    var cards = flashcards.filter(function(f) { return f.cat === cat; });
    // Sort: overdue review → learning → new → future
    return cards.sort(function(a, b) {
      var ca = sm2Get('fc:' + a.term), cb = sm2Get('fc:' + b.term);
      var pa = _interleavePriority(ca, now), pb = _interleavePriority(cb, now);
      return pa - pb;
    }).slice(0, 40); // cap per-category to keep session sane
  });

  // Round-robin interleave
  var deck  = [];
  var maxLen = Math.max.apply(null, buckets.map(function(b) { return b.length; }));
  for (var i = 0; i < maxLen; i++) {
    buckets.forEach(function(b) {
      if (b[i]) deck.push(b[i]);
    });
  }
  return deck;
}

function _interleavePriority(c, now) {
  if (c.state === 'review'    && c.due <= now) return 0;
  if (c.state === 'learning'  && c.due <= now) return 1;
  if (c.state === 'new')                       return 2;
  return 3; // not yet due — de-prioritise
}

/**
 * Activate Mixed Mode on the flashcard screen.
 * Called by the "Mixed 🔀" button and also from filterFC if cat === 'Mixed 🔀'.
 */
window.filterMixed = function() {
  var cats = _getWeakestCategories(3);
  if (cats.length < 2) {
    if (typeof showSettingsToast === 'function') {
      showSettingsToast('Study more categories first to unlock Mixed Mode!');
    }
    return;
  }

  _mixedActive = true;
  var deck = _buildInterleavedDeck(cats);
  if (!deck.length) {
    if (typeof showSettingsToast === 'function') {
      showSettingsToast('No cards due in those categories right now.');
    }
    _mixedActive = false;
    return;
  }

  // Inject into the flashcard system
  if (typeof fcFiltered !== 'undefined') {
    window.fcFiltered = deck;
    window.fcIndex    = 0;
    window.fcFlipped  = false;
    window.fcActiveCategory = 'Mixed 🔀';
  }

  // Update category bar active state
  if (typeof renderFCCategories === 'function') renderFCCategories();
  if (typeof updateFC === 'function') updateFC();

  // Show toast with category names
  if (typeof showSettingsToast === 'function') {
    showSettingsToast('🔀 Mixing: ' + cats.join(', '));
  }

  // Add Mixed to the category bar if not there
  _ensureMixedButton(cats);
};

/**
 * Add/update the Mixed mode button in the category row.
 */
function _ensureMixedButton(cats) {
  var row = document.getElementById('fcCategories');
  if (!row) return;
  var existing = row.querySelector('.fc-cat-btn--mixed');
  var label = '🔀 Mixed';
  if (existing) {
    existing.title = 'Studying: ' + (cats || []).join(', ');
    existing.classList.toggle('active', _mixedActive);
    return;
  }
  var btn = document.createElement('button');
  btn.className = 'fc-cat-btn fc-cat-btn--mixed' + (_mixedActive ? ' active' : '');
  btn.textContent = label;
  btn.title = cats ? 'Studying: ' + cats.join(', ') : 'Mix your 3 weakest categories';
  btn.onclick = function() { filterMixed(); };
  row.insertBefore(btn, row.firstChild);
}

// Inject Mixed button whenever categories are rendered
document.addEventListener('DOMContentLoaded', function() {
  if (typeof renderFCCategories === 'function') {
    var _origRFC = renderFCCategories;
    window.renderFCCategories = function() {
      _origRFC.apply(this, arguments);
      _ensureMixedButton(null);
    };
  }
  // Also deactivate mixed flag when user picks a regular category
  if (typeof filterFC === 'function') {
    var _origFC = filterFC;
    window.filterFC = function(cat) {
      if (cat !== 'Mixed 🔀') _mixedActive = false;
      return _origFC.apply(this, arguments);
    };
  }
});


/* ═══════════════════════════════════════════════════════════════
   2. FEYNMAN VOICE MODE
   Uses the Web Speech API (SpeechRecognition) for voice-to-text.
   Falls back to typed text if the browser doesn't support it.
═══════════════════════════════════════════════════════════════ */

var _feynmanEnabled   = false;
var _feynmanRecording = false;
var _feynmanTranscript = '';
var _recognition      = null;
var _feynmanLSKey     = 'medpath_feynman_v1';

function _feynmanLoad() {
  try { _feynmanEnabled = localStorage.getItem(_feynmanLSKey) === '1'; } catch(e) {}
}
function _feynmanSave() {
  try { localStorage.setItem(_feynmanLSKey, _feynmanEnabled ? '1' : '0'); } catch(e) {}
}

/** Toggle Feynman mode on/off from the microphone button */
window.toggleFeynmanMode = function() {
  _feynmanEnabled = !_feynmanEnabled;
  _feynmanSave();
  _updateFeynmanToggleBtn();
  if (_feynmanEnabled) {
    if (typeof showSettingsToast === 'function') {
      showSettingsToast('🎤 Feynman mode ON — explain each card aloud before flipping');
    }
    _feynmanInjectUI();
  } else {
    _feynmanRemoveUI();
    if (typeof showSettingsToast === 'function') {
      showSettingsToast('🎤 Feynman mode OFF');
    }
  }
};

function _updateFeynmanToggleBtn() {
  var btn = document.getElementById('feynmanToggleBtn');
  if (!btn) return;
  btn.classList.toggle('feynman-btn--active', _feynmanEnabled);
  btn.title = _feynmanEnabled ? 'Feynman mode ON — tap to disable' : 'Feynman mode OFF — tap to enable';
  btn.setAttribute('aria-pressed', _feynmanEnabled ? 'true' : 'false');
}

/** Inject the Feynman panel above the flashcard */
function _feynmanInjectUI() {
  if (document.getElementById('feynmanPanel')) return;
  var wrapper = document.querySelector('.fc-wrapper');
  if (!wrapper) return;
  var panel = document.createElement('div');
  panel.id = 'feynmanPanel';
  panel.className = 'feynman-panel';
  panel.innerHTML =
    '<div class="feynman-header">'
    + '<span class="feynman-label">🧠 Feynman Mode</span>'
    + '<span class="feynman-hint">Explain the concept aloud before flipping</span>'
    + '</div>'
    + '<div class="feynman-body">'
    + '<div class="feynman-transcript" id="feynmanTranscript">'
    + '<span class="feynman-placeholder">Tap 🎤 to start speaking...</span>'
    + '</div>'
    + '<div class="feynman-controls">'
    + '<button class="feynman-mic-btn" id="feynmanMicBtn" onclick="feynmanToggleRecording()">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>'
    + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M19 10a7 7 0 0 1-14 0M12 19v3M8 22h8"/>'
    + '</svg>'
    + '</button>'
    + '<button class="feynman-skip-btn" onclick="feynmanSkip()" title="Skip — just flip the card">Skip →</button>'
    + '</div>'
    + '</div>'
    // Self-assessment row — hidden until card is flipped
    + '<div class="feynman-assess hidden" id="feynmanAssess">'
    + '<div class="feynman-assess-label">How accurate was your explanation?</div>'
    + '<div class="feynman-assess-btns">'
    + '<button class="feynman-assess-btn feynman-assess-btn--nail"   onclick="feynmanRate(4)">💡 Nailed it</button>'
    + '<button class="feynman-assess-btn feynman-assess-btn--close"  onclick="feynmanRate(3)">👍 Pretty close</button>'
    + '<button class="feynman-assess-btn feynman-assess-btn--miss"   onclick="feynmanRate(2)">🤔 Missed details</button>'
    + '<button class="feynman-assess-btn feynman-assess-btn--off"    onclick="feynmanRate(1)">❌ Way off</button>'
    + '</div>'
    + '</div>';
  // Insert before the flashcard
  var fc = wrapper.querySelector('.flashcard');
  if (fc) wrapper.insertBefore(panel, fc);
  else wrapper.prepend(panel);
  _feynmanTranscript = '';
}

function _feynmanRemoveUI() {
  _feynmanStopRecording();
  var panel = document.getElementById('feynmanPanel');
  if (panel) panel.remove();
}

/** Called by flipCard() hook — shows self-assessment after flip */
function _feynmanOnFlip(isBack) {
  if (!_feynmanEnabled) return;
  var assess = document.getElementById('feynmanAssess');
  var panel  = document.getElementById('feynmanPanel');
  if (!assess || !panel) return;

  if (isBack) {
    // Card is now showing answer
    _feynmanStopRecording();
    assess.classList.remove('hidden');
    // Hide SRS rating buttons — Feynman mode replaces them
    var srsRow = document.getElementById('fcSrsRow');
    if (srsRow) srsRow.classList.add('hidden');
  } else {
    // Card flipped back to question
    assess.classList.add('hidden');
    _feynmanTranscript = '';
    var el = document.getElementById('feynmanTranscript');
    if (el) el.innerHTML = '<span class="feynman-placeholder">Tap 🎤 to start speaking...</span>';
    var btn = document.getElementById('feynmanMicBtn');
    if (btn) btn.classList.remove('feynman-mic-btn--active');
  }
}

/** Map Feynman self-assessment → SM-2 rating then call rateCard */
window.feynmanRate = function(rating) {
  var assess = document.getElementById('feynmanAssess');
  if (assess) assess.classList.add('hidden');
  // Show SRS row briefly to show the interval preview, then auto-rate
  if (typeof rateCard === 'function') rateCard(rating);
  // Reset transcript
  _feynmanTranscript = '';
};

window.feynmanSkip = function() {
  // Skip the Feynman step and just flip normally
  if (typeof flipCard === 'function') flipCard();
};

// ── Speech Recognition ────────────────────────────────────────────

function _initRecognition() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  var r = new SR();
  r.continuous      = true;
  r.interimResults  = true;
  r.lang            = 'en-US';
  r.maxAlternatives = 1;
  return r;
}

window.feynmanToggleRecording = function() {
  if (_feynmanRecording) {
    _feynmanStopRecording();
  } else {
    _feynmanStartRecording();
  }
};

function _feynmanStartRecording() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    // Fallback: editable text area
    _feynmanFallbackToText();
    return;
  }

  if (!_recognition) {
    _recognition = _initRecognition();
    if (!_recognition) { _feynmanFallbackToText(); return; }

    _recognition.onresult = function(event) {
      var interim = '', final = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) _feynmanTranscript += final;
      var el = document.getElementById('feynmanTranscript');
      if (el) {
        el.textContent = _feynmanTranscript + (interim ? ' ' + interim : '');
        el.classList.remove('feynman-placeholder');
        if (!el.textContent.trim()) {
          el.innerHTML = '<span class="feynman-placeholder">Speak now...</span>';
        }
      }
    };

    _recognition.onerror = function(e) {
      console.warn('[Feynman] Speech error:', e.error);
      _feynmanRecording = false;
      var btn = document.getElementById('feynmanMicBtn');
      if (btn) btn.classList.remove('feynman-mic-btn--active');
      if (e.error === 'not-allowed') {
        _feynmanFallbackToText();
        if (typeof showSettingsToast === 'function') {
          showSettingsToast('⚠️ Microphone access denied — using text input instead');
        }
      }
    };

    _recognition.onend = function() {
      if (_feynmanRecording) {
        // Auto-restart to keep listening
        try { _recognition.start(); } catch(_) { _feynmanRecording = false; }
      }
    };
  }

  try {
    _recognition.start();
    _feynmanRecording = true;
    var btn = document.getElementById('feynmanMicBtn');
    if (btn) btn.classList.add('feynman-mic-btn--active');
    var el = document.getElementById('feynmanTranscript');
    if (el) el.innerHTML = '<span class="feynman-placeholder feynman-placeholder--recording">🔴 Listening...</span>';
  } catch(e) {
    console.warn('[Feynman] Could not start recognition:', e);
    _feynmanFallbackToText();
  }
}

function _feynmanStopRecording() {
  _feynmanRecording = false;
  if (_recognition) {
    try { _recognition.stop(); } catch(_) {}
  }
  var btn = document.getElementById('feynmanMicBtn');
  if (btn) btn.classList.remove('feynman-mic-btn--active');
}

/** Fallback for browsers without SpeechRecognition */
function _feynmanFallbackToText() {
  var el = document.getElementById('feynmanTranscript');
  if (!el) return;
  el.innerHTML = '<textarea id="feynmanTextArea" class="feynman-textarea" placeholder="Type your explanation here..." rows="3"></textarea>';
  var ta = document.getElementById('feynmanTextArea');
  if (ta) {
    ta.focus();
    ta.oninput = function() { _feynmanTranscript = ta.value; };
  }
  // Hide the mic button since we're in text mode
  var btn = document.getElementById('feynmanMicBtn');
  if (btn) btn.style.display = 'none';
}

// ── Hook into flipCard ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  // Load saved preference
  _feynmanLoad();

  // Hook flipCard to trigger Feynman assessment
  if (typeof flipCard === 'function') {
    var _origFlip = flipCard;
    window.flipCard = function() {
      // Check current flip state BEFORE flipping
      var wasBack = (typeof fcFlipped !== 'undefined') ? fcFlipped : false;
      _origFlip.apply(this, arguments);
      if (_feynmanEnabled) {
        // After flip: fcFlipped has toggled
        var isNowBack = (typeof fcFlipped !== 'undefined') ? fcFlipped : !wasBack;
        _feynmanOnFlip(isNowBack);
      }
    };
  }

  // Inject Feynman UI if mode was saved as enabled
  if (_feynmanEnabled) {
    setTimeout(function() {
      _feynmanInjectUI();
      _updateFeynmanToggleBtn();
    }, 400);
  }

  // Hook filterFC to reset Feynman state on deck change
  if (typeof filterFC === 'function') {
    var _existingFC = filterFC;
    window.filterFC = function(cat) {
      _feynmanRemoveUI();
      _feynmanTranscript = '';
      var result = _existingFC.apply(this, arguments);
      if (_feynmanEnabled) {
        setTimeout(function() {
          _feynmanInjectUI();
        }, 50);
      }
      return result;
    };
  }

  // Hook showScreen: re-inject Feynman UI when returning to flashcards
  if (typeof showScreen === 'function') {
    var _origSS = showScreen;
    window.showScreen = function(id) {
      _origSS.apply(this, arguments);
      if (id === 'flashcards' && _feynmanEnabled) {
        setTimeout(function() {
          if (!document.getElementById('feynmanPanel')) _feynmanInjectUI();
          _updateFeynmanToggleBtn();
        }, 200);
      }
    };
  }
});
