/*
 * NeX Camp — service worker (PS07 extension pack, 2G).
 *
 * App shell: the page, its hashed assets and fonts are cached so the app opens
 * with no connection. Last data: GET responses from the extension's read
 * endpoints are cached per signed-in user; when the network fails, the cached
 * copy is returned with `__cachedAt` added to its data so the page labels it
 * CACHED COPY instead of presenting it as fresh.
 *
 * It never touches writes (the app's own localStorage queue handles those),
 * never caches authentication, and never answers the original API endpoints
 * — the existing in-app cache in lib/net.js keeps doing that, unchanged.
 */
const VERSION = "nex-ext-v2";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/logo-mark.png"];
const DATA_PATHS = ["/api/notices/feed", "/api/requests/mine", "/api/timetable/week", "/api/timetable/attendance-adjusted", "/api/fees/me", "/api/mess-menu", "/api/documents", "/api/board", "/api/fix/mine", "/api/faq/sections"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function userKey(request) {
  const auth = request.headers.get("authorization") || "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function lastData(request) {
  const url = new URL(request.url);
  const key = `${url.origin}${url.pathname}${url.search}${url.search ? "&" : "?"}__u=${await userKey(request)}`;
  const cache = await caches.open(DATA);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const body = await response.clone().text();
      await cache.put(key, new Response(body, { headers: { "content-type": "application/json", "x-nex-cached-at": new Date().toISOString() } }));
    }
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (!hit) throw error;
    const json = await hit.json();
    if (json && json.data && typeof json.data === "object" && !Array.isArray(json.data)) json.data.__cachedAt = hit.headers.get("x-nex-cached-at");
    return new Response(JSON.stringify(json), { headers: { "content-type": "application/json", "x-nex-sw": "cache" } });
  }
}

async function shellFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL);
    cache.put("/index.html", response.clone());
    return response;
  } catch {
    return (await caches.match("/index.html")) || (await caches.match("/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") return event.respondWith(navigate(request));
  if (url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || SHELL_URLS.includes(url.pathname) || url.pathname.endsWith(".svg"))) {
    return event.respondWith(shellFirst(request));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return event.respondWith(shellFirst(request));
  if (DATA_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return event.respondWith(lastData(request));
});
