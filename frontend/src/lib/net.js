// Low-bandwidth behaviour for the API client.
//
// The campus network is patchy, so this layer makes the app tolerate a bad
// connection rather than claiming to improve one. Four mechanisms, all of them
// plain browser features — no service worker, no new dependency:
//
//   cache      a short-lived in-memory copy of each GET, plus a longer-lived
//              localStorage copy. A read that fails on a dead connection is
//              answered from the last good response and flagged `stale`, so the
//              interface can say "showing cached data from 14:02" instead of
//              going blank.
//   retry      one bounded retry with backoff on transport failures and 5xx.
//              Never on a 4xx, which will not get better by being asked again.
//   queue      writes attempted while offline are held and replayed when the
//              connection returns, newest last, at most once each.
//   priority   a critical write (a gate-pass scan) jumps the queue.
//
// Nothing here changes what the API returns. A caller that does not opt in
// behaves exactly as it did before.

const MEMORY_TTL_MS = 20_000;
const DISK_PREFIX = "nex:cache:";
const QUEUE_KEY = "nex:queue";
const MAX_QUEUE = 40;

const memory = new Map();

/** localStorage is unavailable in private mode and can throw on write. */
function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "nex:probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const store = safeStorage();

// One-time move of data saved under the old "cio:" prefix (before the NeX Camp
// rename), so a queued offline write or a cached read is not lost.
if (store) {
  try {
    for (const key of Object.keys(store)) {
      if (!key.startsWith("cio:")) continue;
      const next = "nex:" + key.slice(4);
      if (store.getItem(next) === null) store.setItem(next, store.getItem(key));
      store.removeItem(key);
    }
  } catch {
    /* storage full or blocked: the old copies simply stay where they are */
  }
}

export function readCache(key, { maxAgeMs = MEMORY_TTL_MS } = {}) {
  const hot = memory.get(key);
  if (hot && Date.now() - hot.at <= maxAgeMs) return { data: hot.data, at: hot.at, stale: false };

  if (!store) return hot ? { data: hot.data, at: hot.at, stale: true } : null;

  try {
    const raw = store.getItem(DISK_PREFIX + key);
    if (!raw) return hot ? { data: hot.data, at: hot.at, stale: true } : null;
    const parsed = JSON.parse(raw);
    return { data: parsed.data, at: parsed.at, stale: Date.now() - parsed.at > maxAgeMs };
  } catch {
    return hot ? { data: hot.data, at: hot.at, stale: true } : null;
  }
}

export function writeCache(key, data) {
  const at = Date.now();
  memory.set(key, { data, at });
  if (!store) return;
  try {
    store.setItem(DISK_PREFIX + key, JSON.stringify({ data, at }));
  } catch {
    // Quota exceeded: drop this app's cached reads and carry on. The data is
    // re-fetchable, so losing it costs a request, not correctness.
    try {
      for (const name of Object.keys(store)) {
        if (name.startsWith(DISK_PREFIX)) store.removeItem(name);
      }
    } catch {
      /* nothing further to try */
    }
  }
}

export function clearCache() {
  memory.clear();
  if (!store) return;
  try {
    for (const name of Object.keys(store)) {
      if (name.startsWith(DISK_PREFIX)) store.removeItem(name);
    }
  } catch {
    /* ignore */
  }
}

export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** A transport failure or a 5xx is worth one more try; a 4xx is not. */
export function isRetryable(error) {
  if (!error) return false;
  if (error.status === 0) return true;
  return error.status >= 500 && error.status < 600;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` up to `tries` times with exponential backoff.
 * Rejects with the last error, so the caller sees the real failure.
 */
export async function withRetry(attempt, { tries = 2, baseDelayMs = 600 } = {}) {
  let lastError;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || i === tries - 1) throw error;
      await wait(baseDelayMs * 2 ** i);
    }
  }
  throw lastError;
}

// ---- the offline write queue ----------------------------------------------

function loadQueue() {
  if (!store) return [];
  try {
    const raw = store.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(items) {
  if (!store) return;
  try {
    store.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
  } catch {
    /* a queue that cannot be persisted simply does not survive a reload */
  }
}

/**
 * Holds one write until the connection returns.
 * `priority: "critical"` puts it at the front — a gate-pass scan must not wait
 * behind a queue of complaint drafts.
 */
export function enqueue(item) {
  const items = loadQueue();
  const entry = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: Date.now() };
  if (item.priority === "critical") items.unshift(entry);
  else items.push(entry);
  saveQueue(items);
  return entry;
}

export function queued() {
  return loadQueue();
}

export function queueSize() {
  return loadQueue().length;
}

export function dropFromQueue(id) {
  saveQueue(loadQueue().filter((item) => item.id !== id));
}

/**
 * Replays the queue against `send`. Each entry is attempted once per flush and
 * removed on success; an entry the server rejects outright (4xx) is removed
 * too, because replaying it will never succeed. Entries that fail on transport
 * stay queued for the next flush.
 */
export async function flushQueue(send) {
  if (!isOnline()) return { sent: 0, failed: 0, remaining: queueSize() };

  const items = loadQueue();
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await send(item);
      dropFromQueue(item.id);
      sent += 1;
    } catch (error) {
      if (error?.status >= 400 && error.status < 500) {
        // The server understood and refused. Keeping it would replay a bad
        // request forever, so it is dropped and reported.
        dropFromQueue(item.id);
        failed += 1;
      } else {
        break; // still offline — stop and keep the rest in order
      }
    }
  }

  return { sent, failed, remaining: queueSize() };
}
