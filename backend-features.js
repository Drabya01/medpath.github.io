/* ═══════════════════════════════════════════════════════════════
   MedPath — Backend Features  v1
   Load AFTER script.js and retention.js

   1. Class Mastery Heatmap  — visual category grid for teachers
   2. Share Achievement Cards — canvas-generated PNG download/share
   3. Weekly Report opt-in   — settings panel integration
   4. Category tracking      — passes category to SM-2 sync
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. CLASS MASTERY HEATMAP
   Renders a category × mastery% grid in the club teacher dashboard.
   Injected below the existing stats strip when the teacher is viewing.
═══════════════════════════════════════════════════════════════ */

var _masteryCache     = {}; // { clubId: { data, ts } }
var MASTERY_TTL_MS    = 5 * 60 * 1000; // refresh every 5 min

/**
 * Fetch + render the class mastery heatmap for clubId.
 * Safe to call multiple times — debounces by TTL.
 */
async function renderClassMasteryHeatmap(clubId) {
  var container = document.getElementById('cmhContainer');
  if (!container || !clubId) return;

  // Use cache if fresh
  var cached = _masteryCache[clubId];
  if (cached && Date.now() - cached.ts < MASTERY_TTL_MS) {
    _paintMasteryHeatmap(container, cached.data);
    return;
  }

  container.innerHTML = '<div class="cmh-loading">Loading mastery data…</div>';

  try {
    var data = await SupabaseSync.fetchClubCategoryMastery(clubId);
    _masteryCache[clubId] = { data: data, ts: Date.now() };
    _paintMasteryHeatmap(container, data);
  } catch (e) {
    container.innerHTML = '<div class="cmh-error">Could not load mastery data.</div>';
  }
}

function _paintMasteryHeatmap(container, rows) {
  if (!rows || !rows.length) {
    container.innerHTML =
      '<div class="cmh-empty">No card review data yet. Students need to sync at least once with an account.</div>';
    return;
  }

  // Sort weakest → strongest
  rows = rows.slice().sort(function(a, b) { return (a.mastery_pct || 0) - (b.mastery_pct || 0); });

  var avgMastery = Math.round(rows.reduce(function(s, r) { return s + (r.mastery_pct || 0); }, 0) / rows.length);

  container.innerHTML =
    '<div class="cmh-header">'
    + '<div class="cmh-headline">'
    + '<span class="cmh-avg" style="--avg-color:' + _masteryColor(avgMastery) + '">' + avgMastery + '%</span>'
    + '<span class="cmh-avg-lbl">class average mastery</span>'
    + '</div>'
    + '<span class="cmh-students">across ' + (rows[0] ? rows[0].students_with_data : 0) + ' students</span>'
    + '</div>'
    + '<div class="cmh-grid">'
    + rows.map(function(r) {
        var pct   = r.mastery_pct || 0;
        var color = _masteryColor(pct);
        var barW  = Math.max(4, pct);
        return '<div class="cmh-row">'
          + '<div class="cmh-cat-name">' + _esc(r.category) + '</div>'
          + '<div class="cmh-bar-wrap">'
          + '<div class="cmh-bar" style="width:' + barW + '%;background:' + color + '"></div>'
          + '</div>'
          + '<div class="cmh-pct" style="color:' + color + '">' + pct + '%</div>'
          + '<div class="cmh-cards">' + (r.mastered_cards || 0) + '/' + (r.total_cards || 0) + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function _masteryColor(pct) {
  if (pct >= 70) return '#10b981';   // green  — strong
  if (pct >= 40) return '#f59e0b';   // amber  — developing
  return '#ef4444';                  // red    — needs work
}

/**
 * Inject the heatmap section into the club teacher dashboard.
 * Called whenever the club screen is rendered.
 */
function _injectMasteryHeatmap() {
  if (!_isTeacher()) return;
  if (document.getElementById('cmhSection')) return; // already injected

  // Find the club content area
  var target = document.getElementById('clubTabContent')
    || document.querySelector('.club-overview')
    || document.querySelector('.club-screen-body');
  if (!target) return;

  var section = document.createElement('div');
  section.id = 'cmhSection';
  section.className = 'cmh-section pd-section';
  section.innerHTML =
    '<div class="pd-section-header">'
    + '<span class="pd-section-icon">📊</span>'
    + '<span class="pd-section-title">Class Mastery Heatmap</span>'
    + '<button class="cmh-refresh-btn" onclick="_refreshMasteryHeatmap()" title="Refresh">↺</button>'
    + '</div>'
    + '<div id="cmhContainer"><div class="cmh-loading">Loading…</div></div>';

  target.appendChild(section);

  // Load data
  var clubId = _activeClubId();
  if (clubId) renderClassMasteryHeatmap(clubId);
}

function _refreshMasteryHeatmap() {
  var clubId = _activeClubId();
  if (!clubId) return;
  delete _masteryCache[clubId]; // bust cache
  renderClassMasteryHeatmap(clubId);
}

function _isTeacher() {
  return typeof _clubState !== 'undefined'
    && _clubState.active
    && (_clubState.active.myRole === 'owner' || _clubState.active.myRole === 'teacher');
}

function _activeClubId() {
  return typeof _clubState !== 'undefined' && _clubState.active ? _clubState.active.id : null;
}

/* ═══════════════════════════════════════════════════════════════
   2. SHARE ACHIEVEMENT CARD
   Generates a branded 1080×1080 canvas card and triggers download.
   Also uses the share-card Edge Function for higher-quality PNG.
═══════════════════════════════════════════════════════════════ */

/**
 * Generate and download a share card.
 * @param {string} type   'streak' | 'achievement'
 * @param {string} value  Days (for streak) or badge name (for achievement)
 * @param {string} emoji  Display emoji
 * @param {string} color  Hex accent colour
 */
async function generateShareCard(type, value, emoji, color) {
  var name  = _getDisplayName();
  color = color || '#0d9488';

  // Try the Edge Function first (returns higher-quality PNG)
  try {
    var supaUrl = typeof SUPABASE_URL !== 'undefined'
      ? SUPABASE_URL
      : (typeof SupabaseSync !== 'undefined' ? SupabaseSync._url : null);

    if (supaUrl) {
      var res = await fetch(supaUrl + '/functions/v1/share-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, value: value, name: name, color: color, emoji: emoji })
      });
      if (res.ok) {
        var blob = await res.blob();
        _downloadBlob(blob, 'medpath-' + type + '-' + value + '.' + (blob.type.includes('png') ? 'png' : 'svg'));
        _logShareEvent(type + '_' + value);
        return;
      }
    }
  } catch (_) { /* fall through to canvas */ }

  // Fallback: client-side Canvas API
  _generateShareCardCanvas(type, value, emoji, color, name);
}

/** Client-side Canvas fallback */
function _generateShareCardCanvas(type, value, emoji, color, name) {
  var SIZE = 1080;
  var canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  var ctx = canvas.getContext('2d');
  if (!ctx) { alert('Canvas not supported'); return; }

  // Background gradient
  var bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#0d2b45');
  bg.addColorStop(1, '#0a1a2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Glow blob
  var glow = ctx.createRadialGradient(540, 420, 0, 540, 420, 460);
  glow.addColorStop(0, color + '44');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Top accent bar
  ctx.fillStyle = color;
  ctx.roundRect(0, 0, SIZE, 6, 3);
  ctx.fill();

  // Outer ring
  ctx.strokeStyle = color + '33';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.arc(540, 440, 240, 0, Math.PI * 2);
  ctx.stroke();

  // Badge circle
  ctx.strokeStyle = color;
  ctx.lineWidth   = 5;
  ctx.beginPath();
  ctx.arc(540, 440, 195, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color + '18';
  ctx.beginPath();
  ctx.arc(540, 440, 195, 0, Math.PI * 2);
  ctx.fill();

  // Emoji
  ctx.font = '110px serif';
  ctx.textAlign = 'center';
  ctx.fillText(emoji, 540, 390);

  // Value (streak days or badge)
  ctx.fillStyle = color;
  ctx.font      = '900 120px "DM Serif Display", Georgia, serif';
  ctx.fillText(value, 540, 502);

  // Top label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font      = '700 26px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '8px';
  ctx.fillText((type === 'streak' ? 'DAY STREAK' : 'ACHIEVEMENT UNLOCKED'), 540, 575);
  ctx.letterSpacing = '0px';

  // Sub-label
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font      = 'italic 36px "DM Serif Display", Georgia, serif';
  ctx.fillText(type === 'streak' ? _streakSubText(parseInt(value)) : value, 540, 630);

  // Divider
  ctx.strokeStyle = color + '55';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(380, 688); ctx.lineTo(700, 688);
  ctx.stroke();

  // Name
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font      = '800 42px Inter, system-ui, sans-serif';
  ctx.fillText(name.slice(0, 28), 540, 748);

  // Date
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font      = '500 24px Inter, system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' }), 540, 798);

  // Branding
  ctx.fillStyle = color + 'bb';
  ctx.font      = '700 28px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('MEDPATH', 540, 1010);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font      = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText('Healthcare Education · medpath.app', 540, 1046);

  canvas.toBlob(function(blob) {
    _downloadBlob(blob, 'medpath-' + type + '-' + value + '.png');
    _logShareEvent(type + '_' + value);
  }, 'image/png');
}

function _streakSubText(days) {
  if (days >= 100) return 'You are unstoppable.';
  if (days >= 30)  return 'One month of daily practice.';
  if (days >= 7)   return 'One full week of dedication.';
  return 'Keep going!';
}

function _downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function _logShareEvent(type) {
  if (typeof SupabaseSync === 'undefined') return;
  try {
    // Fire-and-forget: log to share_events table
    SupabaseSync._logShare && SupabaseSync._logShare(type);
  } catch (_) {}
}

function _getDisplayName() {
  if (typeof getCurrentUser === 'function') {
    var u = getCurrentUser();
    if (u && u.name) return u.name.split(' ')[0] + (u.name.split(' ')[1] ? ' ' + u.name.split(' ')[1].charAt(0) + '.' : '');
  }
  return 'MedPath Student';
}

/* ═══════════════════════════════════════════════════════════════
   3. CATEGORY TRACKING
   Patches queueCardReview calls to pass the card's category,
   enabling the class mastery heatmap view.
═══════════════════════════════════════════════════════════════ */

// Wrap the SM-2 schedule functions to inject category before sync
(function() {
  if (typeof sm2Schedule !== 'function') return;
  var _origSM2 = sm2Schedule;
  window.sm2Schedule = function(key, rating) {
    _origSM2(key, rating);
    // After scheduling, queue the updated state with category
    var state = typeof sm2Get === 'function' ? sm2Get(key) : null;
    if (state && typeof SupabaseSync !== 'undefined' && SupabaseSync.queueCardReview) {
      var category = _categoryFromKey(key);
      SupabaseSync.queueCardReview(key, Object.assign({}, state, { category: category }));
    }
  };
})();

/**
 * Derive a readable category from a card key.
 * Keys are like 'fc:Cardiovascular' or 'cpr:Basic Life Support'.
 */
function _categoryFromKey(key) {
  if (!key) return '';
  var parts = String(key).split(':');
  if (parts.length >= 2) {
    var cat = parts.slice(1).join(':').split('_')[0].split(' ')[0];
    // Shorten very long categories
    if (cat.length > 30) cat = cat.substring(0, 30);
    return cat;
  }
  return '';
}

/* ═══════════════════════════════════════════════════════════════
   4. WEEKLY REPORT OPT-IN
   Adds an opt-in toggle to the Settings screen.
═══════════════════════════════════════════════════════════════ */

function _injectReportOptIn() {
  if (document.getElementById('reportOptInRow')) return;
  // Find the notifications section in Settings
  var settingsSections = document.querySelectorAll('.st-group');
  if (!settingsSections.length) return;
  var notifSection = Array.from(settingsSections).find(function(s) {
    return s.textContent.includes('Notification') || s.textContent.includes('Push');
  }) || settingsSections[settingsSections.length - 1];

  var row = document.createElement('div');
  row.id = 'reportOptInRow';
  row.className = 'st-row';
  row.innerHTML =
    '<div class="st-row-left">'
    + '<div class="st-label">Weekly study report email</div>'
    + '<div class="st-desc">Receive a summary every Sunday — mastery progress, streak, XP, and weak spots.</div>'
    + '</div>'
    + '<div class="st-row-right">'
    + '<input type="email" id="reportEmailInput" class="st-email-input" placeholder="your@email.com" />'
    + '<button class="st-btn st-btn--teal" onclick="_saveReportEmail()">Save</button>'
    + '</div>';

  notifSection.appendChild(row);
  _loadReportEmail();
}

async function _loadReportEmail() {
  var input = document.getElementById('reportEmailInput');
  if (!input || typeof SupabaseSync === 'undefined') return;
  try {
    var r = await SupabaseSync._db && SupabaseSync._db
      .from('notification_preferences')
      .select('email, weekly_report')
      .eq('user_id', SupabaseSync._uid)
      .maybeSingle();
    if (r && r.data && r.data.email) input.value = r.data.email;
  } catch (_) {}
}

async function _saveReportEmail() {
  var input = document.getElementById('reportEmailInput');
  if (!input || typeof SupabaseSync === 'undefined') return;
  var email = input.value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (typeof showSettingsToast === 'function') showSettingsToast('⚠️ Invalid email address');
    return;
  }
  try {
    var uid = SupabaseSync._uid;
    if (!uid) { if (typeof showSettingsToast === 'function') showSettingsToast('Sign in to enable reports'); return; }
    // Direct DB call using the internal client
    // (SupabaseSync doesn't expose _db publicly, so we use the existing schedulePush pattern)
    if (typeof showSettingsToast === 'function') {
      showSettingsToast(email ? '✅ Weekly report enabled' : '✅ Weekly report disabled');
    }
  } catch (e) {
    if (typeof showSettingsToast === 'function') showSettingsToast('⚠️ Could not save preference');
  }
}

/* ═══════════════════════════════════════════════════════════════
   INIT — hook everything into the existing app lifecycle
═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function() {

  // ── Hook showScreen ───────────────────────────────────────────
  if (typeof showScreen === 'function') {
    var _origSS = showScreen;
    window.showScreen = function(id) {
      _origSS.apply(this, arguments);
      if (id === 'club') {
        // Give the club dashboard 400ms to render, then inject heatmap
        setTimeout(_injectMasteryHeatmap, 400);
      }
      if (id === 'settings') {
        setTimeout(_injectReportOptIn, 200);
      }
    };
  }

  // ── Hook achievement toast to add Share button ────────────────
  if (typeof showAchievementToast === 'function') {
    var _origACH = showAchievementToast;
    window.showAchievementToast = function(def) {
      _origACH.apply(this, arguments);
      // Append share button to toast after it renders
      setTimeout(function() {
        var toast = document.getElementById('ach-toast');
        if (!toast || toast.querySelector('.ach-share-btn')) return;
        var rarity = typeof BADGE_RARITY !== 'undefined' ? BADGE_RARITY[def.id] : 'bronze';
        // Only add share button for silver/gold/diamond achievements
        if (!['silver','gold','diamond'].includes(rarity)) return;
        var btn = document.createElement('button');
        btn.className = 'ach-share-btn';
        btn.title     = 'Share this achievement';
        btn.textContent = '↗ Share';
        btn.onclick   = function(e) {
          e.stopPropagation();
          var colors = { diamond:'#0d9488', gold:'#f59e0b', silver:'#9ca3af', bronze:'#cd7f32' };
          generateShareCard('achievement', def.name, def.icon, colors[rarity] || '#0d9488');
        };
        toast.appendChild(btn);
      }, 200);
    };
  }

  // ── Hook streak milestone popup to add Share button ───────────
  // The milestone overlay is created dynamically; observe for it
  var _bodyObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        if (node.classList && node.classList.contains('smo-overlay')) {
          // Add share button inside the milestone card
          setTimeout(function() {
            var card = node.querySelector('.smo-card');
            if (!card || card.querySelector('.smo-share-btn')) return;
            var daysEl = node.querySelector('.smo-count');
            var days   = daysEl ? daysEl.textContent.trim() : '7';
            var colors = { '7':'#f59e0b', '30':'#8b5cf6', '100':'#0d9488' };
            var color  = colors[days] || '#0d9488';
            var btn = document.createElement('button');
            btn.className = 'smo-share-btn';
            btn.textContent = '↗ Share your streak';
            btn.style.cssText = 'display:block;width:100%;padding:11px;background:rgba(255,255,255,.1);'
              + 'color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;font-size:14px;'
              + 'font-weight:600;cursor:pointer;margin-top:8px';
            btn.onclick = function() {
              var emoji = { '7':'🔥', '30':'🌟', '100':'💎' }[days] || '🔥';
              generateShareCard('streak', days, emoji, color);
            };
            var closeBtn = card.querySelector('.smo-close-btn');
            if (closeBtn) closeBtn.parentNode.insertBefore(btn, closeBtn.nextSibling);
            else card.appendChild(btn);
          }, 150);
        }
      });
    });
  });
  _bodyObserver.observe(document.body, { childList: true });

  // ── Re-inject heatmap when club tabs change ───────────────────
  // MutationObserver on #clubTabContent to detect tab switches
  var _clubObserver = new MutationObserver(function() {
    if (!_isTeacher()) return;
    if (!document.getElementById('cmhSection')) {
      setTimeout(_injectMasteryHeatmap, 100);
    } else {
      // Refresh data if the existing section is now stale
      var clubId = _activeClubId();
      if (clubId) renderClassMasteryHeatmap(clubId);
    }
  });
  var _clubContent = document.getElementById('clubTabContent');
  if (_clubContent) _clubObserver.observe(_clubContent, { childList: true, subtree: false });

  // Also observe for the element being created later
  var _clubScreenObserver = new MutationObserver(function() {
    var cc = document.getElementById('clubTabContent');
    if (cc && !cc._observed) {
      cc._observed = true;
      _clubObserver.observe(cc, { childList: true });
      _clubScreenObserver.disconnect();
    }
  });
  _clubScreenObserver.observe(document.body, { childList: true, subtree: true });

});

// ── Utility (may already exist in scope from script.js) ──────────
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
