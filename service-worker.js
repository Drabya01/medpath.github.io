/**
 * MedPath Service Worker
 * Strategy:
 *   - Core app files (HTML, JS, CSS) → Cache-first, background update
 *   - Google Fonts → Cache-first (long-lived, versioned by Google)
 *   - Google Auth script → Network-first (needs fresh token endpoints)
 *   - Everything else → Network with cache fallback
 *
 * Cache versioning: bump CACHE_VERSION when you deploy new files.
 * The old cache is deleted automatically on activate.
 */

const CACHE_VERSION  = 'medpath-v13';
const FONT_CACHE     = 'medpath-fonts-v1';
const DYNAMIC_CACHE  = 'medpath-dynamic-v1';

// Files to pre-cache on install — the complete offline shell
const PRECACHE_URLS = [
  './index.html',
  './script.js?v=7',
  './style.css?v=9',
  './manifest.json',
  './tour.js?v=5',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── INSTALL ────────────────────────────────────────────────────
// Pre-cache the app shell immediately
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function() {
        // Skip waiting so the new SW activates immediately
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
// Delete old caches from previous versions
self.addEventListener('activate', function(event) {
  var KEEP = [CACHE_VERSION, FONT_CACHE, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys
            .filter(function(k) { return !KEEP.includes(k); })
            .map(function(k) {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
        );
      })
      .then(function() {
        // Take control of all open clients immediately
        return self.clients.claim();
      })
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // 1. Skip non-GET requests and chrome-extension, data: URLs
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // 2. Google Auth script — network-first, short cache fallback only
  if (url.hostname === 'accounts.google.com') {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE, 5000));
    return;
  }

  // 3. Google Fonts CSS + webfont files — cache-first (they're immutable once fetched)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, FONT_CACHE));
    return;
  }

  // 4. Core app shell — stale-while-revalidate
  //    Serve from cache immediately, update cache in background
  if (isCoreFile(url)) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_VERSION));
    return;
  }

  // 5. Everything else — network with cache fallback
  event.respondWith(networkWithCacheFallback(event.request, DYNAMIC_CACHE));
});

// ── Helpers ─────────────────────────────────────────────────────

function isCoreFile(url) {
  return url.pathname.match(/\/(index\.html|script\.js|style\.css|manifest\.json)$/) ||
         url.pathname.match(/\/icons\/icon-/);
}

/**
 * Cache-first: serve from cache, fall back to network (and cache the result).
 * Best for immutable assets (fonts, icons).
 */
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    });
  });
}

/**
 * Stale-while-revalidate: return cached version immediately,
 * fetch fresh copy in background and update cache.
 * Best for app shell files — instant load + always up to date.
 */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var fetchPromise = fetch(request).then(function(response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() { /* offline — use cached */ });

      // Return cached immediately if we have it, otherwise wait for network
      return cached || fetchPromise || offlineFallback(request);
    });
  });
}

/**
 * Network-first with timeout: try network, fall back to cache.
 * Best for auth scripts that need fresh data but can work offline.
 */
function networkFirst(request, cacheName, timeoutMs) {
  return caches.open(cacheName).then(function(cache) {
    var networkPromise = Promise.race([
      fetch(request).then(function(response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, timeoutMs);
      })
    ]);

    return networkPromise.catch(function() {
      return cache.match(request).then(function(cached) {
        return cached || offlineFallback(request);
      });
    });
  });
}

/**
 * Network with cache fallback: try network, serve cached on failure.
 * Best for dynamic resources.
 */
function networkWithCacheFallback(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return fetch(request).then(function(response) {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function() {
      return cache.match(request).then(function(cached) {
        return cached || offlineFallback(request);
      });
    });
  });
}

/**
 * Offline fallback: return cached index.html for navigation requests,
 * or a minimal error response for assets.
 */
function offlineFallback(request) {
  if (request.mode === 'navigate' || request.headers.get('accept').includes('text/html')) {
    return caches.match('./index.html');
  }
  return new Response('', { status: 503, statusText: 'Offline' });
}

// ── UPDATE NOTIFICATION ─────────────────────────────────────────
// Tell all open clients when a new version is ready
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
