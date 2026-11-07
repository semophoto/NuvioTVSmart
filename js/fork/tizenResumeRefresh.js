// Fork (semophoto): refresh Home when the app comes back from the background.
//
// On Tizen, Back only hides the app (see tizenAdapter.backgroundApp), so a
// session can last days. Upstream refreshes Home's catalogs and Continue
// Watching when the viewer returns to Home from another screen, but reopening
// the hidden app never leaves Home, so nothing refreshed until a restart.
// This runs the same route-return refresh on resume. It is throttled by
// upstream's own 15 minute catalog freshness window, keeps rows and focus in
// place, and only swaps rows whose content changed.

// Give the network a moment to come back after the TV wakes the app.
const RESUME_REFRESH_DELAY_MS = 1500;
// A short hide (a quick look at another app) is not worth a refresh.
const MIN_HIDDEN_MS = 60 * 1000;

export function installTizenResumeRefresh({ Platform, Router }) {
  if (!Platform?.isTizen?.() || typeof document === "undefined") {
    return;
  }
  let hiddenAt = 0;
  let timer = null;
  const isHidden = () => document.visibilityState === "hidden" || document.webkitHidden === true;
  const onVisibility = () => {
    if (isHidden()) {
      hiddenAt = hiddenAt || Date.now();
      clearTimeout(timer);
      timer = null;
      return;
    }
    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (hiddenFor < MIN_HIDDEN_MS || timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (isHidden() || Router.getCurrent() !== "home") {
        return;
      }
      const home = Router.getCurrentScreen();
      if (typeof home?.refreshHomeAfterRouteReturn !== "function") {
        return;
      }
      void Promise.resolve(
        home.refreshHomeAfterRouteReturn({ preserveReturnState: true, reason: "app-resume" })
      ).catch((error) => {
        console.warn("Home resume refresh failed", error);
      });
    }, RESUME_REFRESH_DELAY_MS);
  };
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("webkitvisibilitychange", onVisibility);
}
