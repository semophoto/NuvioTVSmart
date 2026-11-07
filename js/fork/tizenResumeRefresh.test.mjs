import assert from "node:assert/strict";
import { test } from "node:test";
import { installTizenResumeRefresh } from "./tizenResumeRefresh.js";

test("reopening the hidden app on Home runs the route-return refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const listeners = {};
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => (listeners[name] = fn)
  };
  const calls = [];
  const home = { refreshHomeAfterRouteReturn: (options) => calls.push(options) };
  installTizenResumeRefresh({
    Platform: { isTizen: () => true },
    Router: { getCurrent: () => "home", getCurrentScreen: () => home }
  });
  const flip = (state) => {
    document.visibilityState = state;
    listeners.visibilitychange();
  };

  flip("hidden");
  t.mock.timers.tick(10 * 1000);
  flip("visible");
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 0, "a short hide does not refresh");

  flip("hidden");
  t.mock.timers.tick(20 * 60 * 1000);
  flip("visible");
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, "app-resume");
});
