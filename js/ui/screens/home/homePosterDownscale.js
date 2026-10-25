// Some addons serve 2000x3000 rating posters for ~220px Home cards. A Tizen
// TV cannot keep hundreds of those decoded, so it re-decodes them on every
// scroll, focus and hero change. Decode each oversized poster once, off the
// main thread, at 3x card size and hand the <img> a small cached blob URL.
// Only Home cards use this; detail pages keep the original URL.
const POSTER_TARGET_WIDTH = 660;
const LANDSCAPE_TARGET_WIDTH = 1000;
const MAX_CACHED = 600;
const MAX_IN_FLIGHT = 6;
// Card-sized posters are small files and not worth a re-encode. Checking the
// byte size avoids decoding twice just to read the width.
const MIN_DOWNSCALE_BYTES = 300 * 1024;

const cache = new Map();
const inFlight = new Map();
const queue = [];
let active = 0;
let supported = null;

function isSupported() {
  if (supported === null) {
    supported =
      typeof fetch === "function" &&
      typeof createImageBitmap === "function" &&
      typeof URL?.createObjectURL === "function" &&
      typeof document !== "undefined";
  }
  return supported;
}

function remember(key, url) {
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const [oldestKey, oldestUrl] = cache.entries().next().value;
    cache.delete(oldestKey);
    // Failed lookups cache the original URL; only revoke our own blobs.
    if (oldestUrl.startsWith("blob:")) URL.revokeObjectURL(oldestUrl);
  }
}

function encode(bitmap) {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      0.9
    )
  );
}

async function downscaleToBlob(src, targetWidth) {
  const response = await fetch(src, { credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.size < MIN_DOWNSCALE_BYTES) return null;
  // Giving only resizeWidth keeps the aspect ratio.
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: targetWidth,
    resizeQuality: "medium"
  });
  try {
    return await encode(bitmap);
  } finally {
    bitmap.close?.();
  }
}

// The resize is off-thread already, but the JPEG encode measured 400-800 ms
// on the page thread on the TV. Run the whole job in a worker when possible.
const WORKER_SOURCE = `
const MIN_DOWNSCALE_BYTES = ${MIN_DOWNSCALE_BYTES};
self.onmessage = async (event) => {
  const { id, src, targetWidth } = event.data;
  try {
    const response = await fetch(src, { credentials: "omit" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    if (blob.size < MIN_DOWNSCALE_BYTES) return self.postMessage({ id, blob: null });
    const bitmap = await createImageBitmap(blob, { resizeWidth: targetWidth, resizeQuality: "medium" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    self.postMessage({ id, blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 }) });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message || error) });
  }
};
`;

let worker;
let workerSeq = 0;
const workerJobs = new Map();

function getWorker() {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    if (typeof Worker === "function" && typeof OffscreenCanvas === "function") {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = ({ data }) => {
        const job = workerJobs.get(data.id);
        if (!job) return;
        workerJobs.delete(data.id);
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(data.blob);
      };
      worker.onerror = () => {
        // A worker that cannot run here falls back to the page thread.
        worker = null;
        workerJobs.forEach((job) => job.fallback());
        workerJobs.clear();
      };
    }
  } catch (_) {
    worker = null;
  }
  return worker;
}

function downscaleInWorker(src, targetWidth) {
  const activeWorker = getWorker();
  if (!activeWorker) return downscaleToBlob(src, targetWidth);
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    workerJobs.set(id, {
      resolve,
      reject,
      fallback: () => downscaleToBlob(src, targetWidth).then(resolve, reject)
    });
    activeWorker.postMessage({ id, src, targetWidth });
  });
}

// Copies are kept in IndexedDB so a relaunch paints Home posters from disk
// instead of downloading and shrinking every 3 MB original again. Rating
// posters change over time, so entries expire after a few days.
const DB_NAME = "nuvio-home-posters";
const DB_STORE = "posters";
const PERSIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED = 1500;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(DB_STORE, { keyPath: "key" });
        store.createIndex("at", "at");
      };
      request.onsuccess = () => {
        const db = request.result;
        resolve(db);
        prunePersisted(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return dbPromise;
}

function prunePersisted(db) {
  try {
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_PERSISTED;
      if (excess <= 0) return;
      store.index("at").openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess -= 1;
        cursor.continue();
      };
    };
  } catch (_) {
    // Pruning is best effort.
  }
}

async function readPersisted(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result;
        resolve(entry && Date.now() - Number(entry.at || 0) < PERSIST_TTL_MS ? entry : null);
      };
      request.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

function writePersisted(key, blob) {
  void openDb().then((db) => {
    if (!db) return;
    try {
      // blob null marks a poster that is already small enough to use as-is.
      db.transaction(DB_STORE, "readwrite")
        .objectStore(DB_STORE)
        .put({ key, blob, at: Date.now() });
    } catch (_) {
      // Quota or a closed database: the in-memory copy still works.
    }
  });
}

async function downscale(src, targetWidth, key) {
  const blob = await downscaleInWorker(src, targetWidth);
  writePersisted(key, blob);
  return blob ? URL.createObjectURL(blob) : src;
}

function pump() {
  while (active < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift();
    active += 1;
    downscale(job.src, job.targetWidth, job.key)
      // Hosts without CORS, or decode errors: keep the original image.
      .catch(() => job.src)
      .then((url) => {
        remember(job.key, url);
        inFlight.delete(job.key);
        job.resolve(url);
      })
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function getHomePosterTargetWidth(image) {
  if (!(image instanceof HTMLImageElement)) return 0;
  if (image.classList.contains("content-poster")) return POSTER_TARGET_WIDTH;
  if (image.classList.contains("home-continue-bg")) return LANDSCAPE_TARGET_WIDTH;
  return 0;
}

export function getCachedHomePoster(src, targetWidth) {
  return cache.get(`${targetWidth}|${src}`) || "";
}

export function resolveHomePoster(src, targetWidth, { urgent = false } = {}) {
  const key = `${targetWidth}|${src}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  if (!isSupported() || !/^https?:/i.test(src)) return Promise.resolve(src);
  const pending = inFlight.get(key);
  if (pending) {
    if (urgent) pending.urgent = true;
    if (urgent && queue.includes(pending)) {
      queue.splice(queue.indexOf(pending), 1);
      queue.unshift(pending);
    }
    return pending.promise;
  }
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  const job = { key, src, targetWidth, resolve, promise, urgent };
  inFlight.set(key, job);
  // The disk lookup does not take a download slot; only misses are queued.
  void readPersisted(key).then((entry) => {
    if (entry) {
      const url = entry.blob ? URL.createObjectURL(entry.blob) : src;
      remember(key, url);
      inFlight.delete(key);
      resolve(url);
      return;
    }
    if (job.urgent) queue.unshift(job);
    else queue.push(job);
    pump();
  });
  return promise;
}
