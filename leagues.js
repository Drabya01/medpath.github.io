/* ═══════════════════════════════════════════════════════════════
   MedPath — Weekly Leagues  v1
   Load AFTER script.js.

   Implements _lbTab + _lbFetch so the existing initLeaderboardScreen()
   in script.js fully works. The leaderboard screen HTML is in index.html.

   League design (Duolingo-inspired):
   ─ Users compete in a weekly division of up to 30
   ─ Top 10  = Promotion zone  (teal ring — move up next week)
   ─ Middle  = Safe zone       (neutral)
   ─ Bottom 10 = Relegation zone (red ring — demoted next week)
   ─ Week resets Monday midnight (already handled by earnXP in script.js)
   ─ 5 tiers: Diamond · Platinum · Gold · Silver · Bronze
═══════════════════════════════════════════════════════════════ */

'use strict';

// ── League tier definitions (by total XP) ────────────────────────
var LEAGUE_TIERS = [
  { name: 'Diamond',  emoji: '💎', color: '#0d9488', minXP: 50000 },
  { name: 'Platinum', emoji: '⚡', color: '#8b5cf6', minXP: 20000 },
  { name: 'Gold',     emoji: '🥇', color: '#f59e0b', minXP: 8000  },
  { name: 'Silver',   emoji: '🥈', color: '#9ca3af', minXP: 2000  },
  { name: 'Bronze',   emoji: '🥉', color: '#cd7f32', minXP: 0     },
];

function _leagueTier(totalXP) {
  for (var i = 0; i < LEAGUE_TIERS.length; i++) {
    if ((totalXP || 0) >= LEAGUE_TIERS[i].minXP) return LEAGUE_TIERS[i];
  }
  return LEAGUE_TIERS[LEAGUE_TIERS.length - 1];
}

// ── Required globals for script.js ──────────────────────────────
// script.js checks: typeof _lbTab !== 'undefined' and typeof _lbFetch === 'function'
var _lbTab = 'week';

function _lbFetch(tab) {
  _lbTab = tab || 'week';

  // Sync active tab styling
  document.querySelectorAll('.lb-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === _lbTab);
  });

  var content = document.getElementById('lbContent');
  var loading = document.getElementById('lbLoading');
  if (loading) loading.classList.remove('hidden');
  if (content) content.innerHTML = '';

  var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) {
    if (loading) loading.classList.add('hidden');
    return;
  }
  if (typeof SupabaseSync === 'undefined') {
    if (loading) loading.classList.add('hidden');
    if (content) content.innerHTML = '<div class="lb-hint">Sign in to compete.</div>';
    return;
  }

  if (_lbTab === 'week') {
    _lbFetchWeekDivision(content, loading);
  } else {
    _lbFetchAllTime(content, loading);
  }
}

// ── Weekly division fetch ─────────────────────────────────────────
async function _lbFetchWeekDivision(content, loading) {
  try {
    var [rows, myRank] = await Promise.all([
      SupabaseSync.fetchLeaderboard('week_xp'),
      SupabaseSync.fetchMyRank('week_xp')
    ]);
    rows = rows || [];
    if (loading) loading.classList.add('hidden');

    // Find the current user in the results
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    var myId  = user ? user.id : null;

    // Create a division of 30 centred around the current user
    var myIdx = rows.findIndex(function(r) { return r.user_id === myId; });
    var div30;
    if (myIdx >= 0) {
      var start = Math.max(0, Math.min(myIdx - 14, rows.length - 30));
      div30 = rows.slice(start, start + 30);
    } else {
      // User not yet on leaderboard — show top 30 + note
      div30 = rows.slice(0, 30);
    }

    // Determine my tier from total_xp
    var myRow  = rows.find(function(r) { return r.user_id === myId; });
    var myTier = _leagueTier(myRow ? myRow.total_xp : 0);

    // Banner
    var daysLeft = _daysUntilMonday();
    _renderLeagueBanner(myTier, myRank, daysLeft, myRow);

    if (!div30.length) {
      if (content) content.innerHTML = '<div class="lb-hint">No scores yet this week. Be first! 🚀</div>';
      return;
    }

    // Render division table
    var PROMO_N = Math.min(10, Math.floor(div30.length / 3));
    var DEMO_N  = Math.min(10, Math.floor(div30.length / 3));

    var html = '<div class="lb-division">';
    html += '<div class="lb-div-header">'
      + '<span class="lb-div-title">' + myTier.emoji + ' ' + myTier.name + ' League</span>'
      + '<span class="lb-div-sub">Resets in ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + '</span>'
      + '</div>';

    // Promotion zone label
    html += '<div class="lb-zone-label lb-zone-label--promo">⬆ Promotion zone (top ' + PROMO_N + ')</div>';

    div30.forEach(function(row, i) {
      var isMe   = row.user_id === myId;
      var zone   = i < PROMO_N ? 'promo' : (i >= div30.length - DEMO_N ? 'demo' : 'safe');
      var medals = ['🥇', '🥈', '🥉'];
      var rankBadge = i < 3 ? medals[i] : '<span class="lb-rank-num">' + (i + 1) + '</span>';

      if (i === PROMO_N) {
        html += '<div class="lb-zone-label lb-zone-label--safe">Safe zone</div>';
      }
      if (i === div30.length - DEMO_N) {
        html += '<div class="lb-zone-label lb-zone-label--demo">⬇ Relegation zone (bottom ' + DEMO_N + ')</div>';
      }

      html += '<div class="lb-row lb-row--' + zone + (isMe ? ' lb-row--me' : '') + '">'
        + '<div class="lb-row-rank">' + rankBadge + '</div>'
        + _lbAvatar(row, 'lb-row-avatar')
        + '<div class="lb-row-info">'
        + '<span class="lb-row-name">' + _esc(row.display_name || 'Student') + (isMe ? ' <span class="lb-you">you</span>' : '') + '</span>'
        + '<span class="lb-row-level">Lv. ' + (row.level || 1) + ' · ' + _leagueTier(row.total_xp).emoji + '</span>'
        + '</div>'
        + '<div class="lb-row-right">'
        + '<span class="lb-row-xp">' + ((row.week_xp || 0).toLocaleString()) + ' XP</span>'
        + _lbWeekBar(row.week_xp, div30[0].week_xp)
        + '</div>'
        + '</div>';
    });

    html += '</div>';
    if (content) content.innerHTML = html;

  } catch(e) {
    if (loading) loading.classList.add('hidden');
    if (content) content.innerHTML = '<div class="lb-error">Could not load league. Check your connection.</div>';
  }
}

// ── All-time fetch ────────────────────────────────────────────────
async function _lbFetchAllTime(content, loading) {
  try {
    var [rows, myRank] = await Promise.all([
      SupabaseSync.fetchLeaderboard('total_xp'),
      SupabaseSync.fetchMyRank('total_xp')
    ]);
    rows = rows || [];
    if (loading) loading.classList.add('hidden');

    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    var myId = user ? user.id : null;

    // Hide league banner for all-time tab
    var banner = document.getElementById('leagueBanner');
    if (banner) banner.innerHTML = '';

    var html = '<div class="lb-division">';
    html += '<div class="lb-div-header">'
      + '<span class="lb-div-title">🌟 All-Time Rankings</span>'
      + (myRank ? '<span class="lb-div-sub">Your rank: #' + myRank + '</span>' : '')
      + '</div>';

    rows.forEach(function(row, i) {
      var isMe     = row.user_id === myId;
      var medals   = ['🥇', '🥈', '🥉'];
      var rankBadge = i < 3 ? medals[i] : '<span class="lb-rank-num">' + (i + 1) + '</span>';
      var tier     = _leagueTier(row.total_xp);
      html += '<div class="lb-row' + (isMe ? ' lb-row--me' : '') + '">'
        + '<div class="lb-row-rank">' + rankBadge + '</div>'
        + _lbAvatar(row, 'lb-row-avatar')
        + '<div class="lb-row-info">'
        + '<span class="lb-row-name">' + _esc(row.display_name || 'Student') + (isMe ? ' <span class="lb-you">you</span>' : '') + '</span>'
        + '<span class="lb-row-level">Lv. ' + (row.level || 1) + ' · ' + tier.emoji + ' ' + tier.name + '</span>'
        + '</div>'
        + '<div class="lb-row-right">'
        + '<span class="lb-row-xp">' + ((row.total_xp || 0).toLocaleString()) + ' XP</span>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
    if (content) content.innerHTML = html;

  } catch(e) {
    if (loading) loading.classList.add('hidden');
    if (content) content.innerHTML = '<div class="lb-error">Could not load all-time rankings.</div>';
  }
}

// ── League banner ─────────────────────────────────────────────────
function _renderLeagueBanner(tier, myRank, daysLeft, myRow) {
  var banner = document.getElementById('leagueBanner');
  if (!banner) return;
  var weekXP = myRow ? (myRow.week_xp || 0) : 0;
  banner.innerHTML =
    '<div class="lb-banner" style="--lb-clr:' + tier.color + '">'
    + '<div class="lb-banner-tier">'
    + '<span class="lb-banner-emoji">' + tier.emoji + '</span>'
    + '<div>'
    + '<div class="lb-banner-tier-name">' + tier.name + ' League</div>'
    + '<div class="lb-banner-tier-sub">' + daysLeft + ' days remaining · ' + weekXP.toLocaleString() + ' XP this week</div>'
    + '</div>'
    + '</div>'
    + (myRank ? '<div class="lb-banner-rank">#' + myRank + '</div>' : '')
    + '</div>';
}

// ── Mini XP bar (relative to leader) ─────────────────────────────
function _lbWeekBar(xp, maxXP) {
  if (!maxXP) return '';
  var pct = Math.max(4, Math.round(((xp || 0) / maxXP) * 100));
  return '<div class="lb-xp-bar"><div class="lb-xp-fill" style="width:' + pct + '%"></div></div>';
}

// ── Days until next Monday ────────────────────────────────────────
function _daysUntilMonday() {
  var now = new Date();
  var day = now.getDay(); // 0=Sun,1=Mon,...6=Sat
  var diff = day === 0 ? 1 : (8 - day) % 7 || 7;
  return diff;
}

// ── Update home teaser with league info ───────────────────────────
function updateLbTeaser() {
  var el = document.getElementById('lbTeaser');
  if (!el) return;
  var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (typeof SupabaseSync === 'undefined') return;
  var sub = document.getElementById('lbTeaserSub');
  SupabaseSync.fetchLeaderboard('week_xp').then(function(rows) {
    if (!rows || !rows.length) { if (sub) sub.textContent = 'Be first on the board this week!'; return; }
    SupabaseSync.fetchMyRank('week_xp').then(function(rank) {
      var names = rows.slice(0, 3)
        .map(function(r, i) { return ['🥇','🥈','🥉'][i] + ' ' + (r.display_name || '').split(' ')[0]; })
        .join('  ');
      var myRow  = rows.find(function(r) {
        var u = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        return u && r.user_id === u.id;
      });
      var tier = _leagueTier(myRow ? myRow.total_xp : 0);
      if (sub) {
        sub.textContent = tier.emoji + ' ' + tier.name + ' League'
          + (rank ? '  ·  #' + rank + ' this week' : '')
          + '  ·  ' + names;
      }
    });
  });
}

// ── Helper (duplicated here to avoid dependency on script.js order) ─
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _lbAvatar(row, cls) {
  if (row.avatar_url) {
    return '<img src="' + row.avatar_url + '" class="' + cls + '" alt="" loading="lazy">';
  }
  var initials = (row.display_name || '?').split(' ').map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
  var colors   = ['#0d9488','#7c3aed','#f59e0b','#0284c7','#dc2626','#059669'];
  var bg       = colors[(row.display_name || '').charCodeAt(0) % colors.length] || '#0d9488';
  return '<div class="' + cls + ' lb-initials" style="background:' + bg + '">' + initials + '</div>';
}
