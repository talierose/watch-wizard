/* Watch Wizard - service worker
 * RELATIVE paths only so it works under a GitHub Pages project path
 * (e.g. https://user.github.io/repo/). Never use absolute "/..." URLs here.
 */
"use strict";

var CACHE_VERSION = "wciw-v6";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

/* Install: pre-cache the app shell. */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails the whole install if any request fails; add resiliently.
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* ignore individual misses */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* Activate: clean up old versioned caches. */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiHost(url) {
  return url.hostname === "api.themoviedb.org" ||
         url.hostname.indexOf(".supabase.co") >= 0 ||
         url.hostname.indexOf(".supabase.in") >= 0;
}
function isTmdbImage(url) {
  return url.hostname === "image.tmdb.org";
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return; // never cache non-GET

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Network-only for TMDB & Supabase APIs — never cache dynamic data. */
  if (isApiHost(url)) {
    return; // let the browser handle it normally (network)
  }

  /* TMDB poster/logo images: stale-while-revalidate in a shared runtime cache. */
  if (isTmdbImage(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var network = fetch(req).then(function (res) {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  /* Navigations: serve cached index.html as an offline fallback so the SPA
     still opens without a network connection. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match("./index.html").then(function (cached) {
          return cached || caches.match("./");
        });
      })
    );
    return;
  }

  /* App shell & other same-origin GETs: cache-first, fall back to network. */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.status === 200 && res.type === "basic") {
            var copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  /* Everything else (e.g. supabase-js CDN): network, fall back to cache if present. */
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
