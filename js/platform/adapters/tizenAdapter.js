import { normalizeKeyEvent, isBackEvent } from "../sharedKeys.js";

function getAvplayApi() {
  const webapis = globalThis.webapis;
  const avplay =
    webapis?.avplay ||
    webapis?.avPlay ||
    globalThis.avplay ||
    globalThis.document?.getElementById?.("avPlayerObject") ||
    null;
  if (!avplay || typeof avplay.open !== "function") {
    return null;
  }
  return avplay;
}

function applyTizenViewport() {
  const documentRef = globalThis.document;
  if (!documentRef?.head) {
    return;
  }

  let viewport = documentRef.querySelector("meta[name='viewport']");
  if (!viewport) {
    viewport = documentRef.createElement("meta");
    viewport.name = "viewport";
    documentRef.head.appendChild(viewport);
  }

  viewport.setAttribute(
    "content",
    "width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
  );
  documentRef.documentElement?.classList?.add("tizen-tv");
  documentRef.body?.classList?.add("tizen-tv");

  try {
    globalThis.dispatchEvent?.(new Event("resize"));
  } catch (_) {
    // Ignore resize dispatch failures on older Tizen engines.
  }
}

// Back on the root screen sends Nuvio to the background instead of closing
// it, so reopening resumes where the user left off. Holding Back closes the
// app for real. The hold is timed from the first keydown of one press. Held
// keys normally repeat keydown until a single keyup; the short release grace
// also covers firmwares that emit keydown/keyup pairs while held, and is far
// below the gap between two deliberate taps.
const BACK_HOLD_EXIT_MS = 1000;
const BACK_RELEASE_GRACE_MS = 60;
const TV_BACK_KEY_CODES = [10009, 461];

const backHold = {
  held: false,
  holdTimer: null,
  releaseTimer: null,
  pendingBackground: false,
  forceExitApp: null
};

function isRemoteBackKey(event) {
  const keyName = String(event?.keyName || event?.key || "").toLowerCase();
  const keyCode = Number(event?.keyCode || event?.which || 0);
  return TV_BACK_KEY_CODES.includes(keyCode) || keyName === "xf86back" || keyName === "back";
}

function getCurrentTizenApplication() {
  try {
    return globalThis.tizen?.application?.getCurrentApplication?.() || null;
  } catch (_) {
    return null;
  }
}

function isBackPressActive() {
  return backHold.held || Boolean(backHold.releaseTimer);
}

function hideApplication() {
  const application = getCurrentTizenApplication();
  if (!application || typeof application.hide !== "function") {
    return false;
  }
  try {
    application.hide();
    return true;
  } catch (error) {
    console.warn("Tizen application hide failed", error);
    return false;
  }
}

function forceExit() {
  backHold.pendingBackground = false;
  if (typeof backHold.forceExitApp === "function") {
    backHold.forceExitApp();
  } else {
    tizenAdapter.exitApp();
  }
}

function endBackPress() {
  clearTimeout(backHold.holdTimer);
  backHold.holdTimer = null;
  backHold.releaseTimer = null;
  backHold.held = false;
  if (backHold.pendingBackground) {
    backHold.pendingBackground = false;
    if (!hideApplication()) {
      forceExit();
    }
  }
}

function onBackHoldReached() {
  backHold.holdTimer = null;
  if (!isBackPressActive()) {
    return;
  }
  forceExit();
}

function handleBackKeyDown(event) {
  if (!isRemoteBackKey(event)) {
    return;
  }
  if (backHold.releaseTimer) {
    clearTimeout(backHold.releaseTimer);
    backHold.releaseTimer = null;
  } else if (!backHold.held) {
    clearTimeout(backHold.holdTimer);
    backHold.holdTimer = setTimeout(onBackHoldReached, BACK_HOLD_EXIT_MS);
  }
  backHold.held = true;
}

function handleBackKeyUp(event) {
  if (!isRemoteBackKey(event) || !backHold.held) {
    return;
  }
  backHold.held = false;
  clearTimeout(backHold.releaseTimer);
  backHold.releaseTimer = setTimeout(endBackPress, BACK_RELEASE_GRACE_MS);
}

function installBackHoldExit(forceExitApp) {
  backHold.forceExitApp = typeof forceExitApp === "function" ? forceExitApp : null;
  if (backHold.installed || typeof globalThis.addEventListener !== "function") {
    return;
  }
  backHold.installed = true;
  // Window capture runs before the FocusEngine's document listeners, and
  // never stops the event: navigation still sees every Back press.
  globalThis.addEventListener("keydown", handleBackKeyDown, true);
  globalThis.addEventListener("keyup", handleBackKeyUp, true);
  // Losing focus mid-press (system overlay, app switch) must not leave a
  // stale hold that later exits the app.
  globalThis.addEventListener("blur", () => {
    clearTimeout(backHold.holdTimer);
    clearTimeout(backHold.releaseTimer);
    backHold.holdTimer = null;
    backHold.releaseTimer = null;
    backHold.held = false;
    backHold.pendingBackground = false;
  });
}

export const tizenAdapter = {
  name: "tizen",

  init({ forceExitApp } = {}) {
    applyTizenViewport();
    installBackHoldExit(forceExitApp);

    const tvInputDevice = globalThis.tizen?.tvinputdevice || null;
    if (!tvInputDevice) {
      return;
    }

    const mediaKeys = [
      "Info",
      "MediaPlayPause",
      "MediaPlay",
      "MediaPause",
      "MediaStop",
      "MediaFastForward",
      "MediaRewind",
      "MediaTrackPrevious",
      "MediaTrackNext"
    ];

    if (typeof tvInputDevice.registerKeyBatch === "function") {
      try {
        tvInputDevice.registerKeyBatch(mediaKeys);
        return;
      } catch (_) {
        // Fall through to per-key registration.
      }
    }

    mediaKeys.forEach((keyName) => {
      try {
        tvInputDevice.registerKey?.(keyName);
      } catch (_) {
        // Ignore missing media-key support on older firmware.
      }
    });
  },

  // Called for a regular "leave the app" Back. Returns true when the app was
  // (or will be, once the Back key is released) moved to the background.
  backgroundApp() {
    if (!getCurrentTizenApplication()) {
      return false;
    }
    if (isBackPressActive()) {
      backHold.pendingBackground = true;
      return true;
    }
    return hideApplication();
  },

  exitApp() {
    try {
      globalThis.tizen?.application?.getCurrentApplication?.().exit?.();
    } catch (_) {
      try {
        globalThis.close?.();
      } catch (_) {
        // Ignore unsupported app-exit APIs in non-TV browsers.
      }
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Tizen TV";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: Boolean(getAvplayApi())
    };
  },

  prepareVideoElement() {}
};
