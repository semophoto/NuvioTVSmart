import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

// Fork-only Tizen tuning for the upstream Home poster rescaler
// (tvPosterRescaler.js). Kept in its own file so upstream updates rarely touch
// it; the rescaler and the hydration pass call in through a few small hooks.
//
// 1. Sharpness: upstream decodes at card size times the measured pixel ratio,
//    which is 1 on a Samsung 4K set that reports a 1920 screen. Rating posters
//    then look soft. Tizen cards get a 3x card-size copy instead (about
//    660x1000 for a poster card), which is still a fraction of a 2000x2962
//    original.
// 2. Caching: copies are kept in IndexedDB for a few days, so a relaunch, or a
//    row that scrolls back after eviction, paints from disk instead of
//    downloading and shrinking every 3 MB original again.

export const TIZEN_ARTWORK_SCALE = 3;
export const TIZEN_ARTWORK_QUALITY = 0.9;

const DB_NAME = "nuvio-home-posters";
const DB_VERSION = 2;
const DB_STORE = "posters";
const PERSIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED = 1500;
// Worker outcomes that will be the same next time, so the original can be used
// straight away without fetching it again just to find that out.
const PERSISTED_SKIP_REASONS = new Set(["already small", "not jpeg", "animated"]);

let tizen = null;
export function isTizenArtworkTuningActive() {
  if (tizen === null) {
    try {
      tizen = getTvRuntimePerformanceProfile().platform === "tizen";
    } catch (_) {
      tizen = false;
    }
  }
  return tizen;
}

/** Pixel ratio for Home artwork copies on Tizen, or 0 to keep upstream's. */
export function getTizenArtworkScale() {
  return isTizenArtworkTuningActive() ? TIZEN_ARTWORK_SCALE : 0;
}

/** Continue Watching backdrops are rescaled too on Tizen. */
export function isTizenRescalableArtwork(image) {
  return isTizenArtworkTuningActive() && Boolean(image?.classList?.contains("home-continue-bg"));
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // Version 1 held the old fork's 660-wide copies under different keys.
        if (db.objectStoreNames.contains(DB_STORE)) db.deleteObjectStore(DB_STORE);
        db.createObjectStore(DB_STORE, { keyPath: "key" }).createIndex("at", "at");
      };
      request.onsuccess = () => {
        resolve(request.result);
        prune(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return dbPromise;
}

function prune(db) {
  try {
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    const expiredBefore = Date.now() - PERSIST_TTL_MS;
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_PERSISTED;
      store.index("at").openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (excess <= 0 && Number(cursor.value?.at || 0) >= expiredBefore) return;
        cursor.delete();
        excess -= 1;
        cursor.continue();
      };
    };
  } catch (_) {
    // Pruning is best effort.
  }
}

/**
 * Look up a stored copy. Resolves to null on a miss, or to { blob } where blob
 * is null when the original should be used as-is.
 */
export function readPersistedArtwork(key) {
  if (!isTizenArtworkTuningActive()) return Promise.resolve(null);
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
          request.onsuccess = () => {
            const entry = request.result;
            resolve(
              entry && Date.now() - Number(entry.at || 0) < PERSIST_TTL_MS
                ? { blob: entry.blob || null }
                : null
            );
          };
          request.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      })
  );
}

/** Store a worker result. Transient failures (network, timeout) are not kept. */
export function writePersistedArtwork(key, blob, reason = "") {
  if (!isTizenArtworkTuningActive()) return;
  if (!blob && !PERSISTED_SKIP_REASONS.has(String(reason || ""))) return;
  void openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(DB_STORE, "readwrite")
        .objectStore(DB_STORE)
        .put({ key, blob: blob || null, at: Date.now() });
    } catch (_) {
      // Quota or a closed database: the in-memory copy still works.
    }
  });
}
