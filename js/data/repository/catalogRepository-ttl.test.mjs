import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
const { CatalogApi } = await import("../remote/api/catalogApi.js");
const { catalogRepository } = await import("./catalogRepository.js");

const request = {
  addonBaseUrl: "https://addon.test",
  addonId: "a",
  catalogId: "top",
  type: "movie"
};
let calls = 0;
let reply = () => ({ metas: [{ id: "tt1", type: "movie", name: "One" }] });
CatalogApi.getCatalog = async () => {
  calls += 1;
  return reply();
};

test("cached catalog pages expire and refetch, keeping the stale page on failure", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  catalogRepository.clearCache();

  const first = await catalogRepository.getCatalog(request);
  assert.equal(first.data.items[0].name, "One");
  await catalogRepository.getCatalog(request);
  assert.equal(calls, 1, "fresh page served from cache");

  now += 16 * 60 * 1000;
  reply = () => ({ metas: [{ id: "tt2", type: "movie", name: "Two" }] });
  const refreshed = await catalogRepository.getCatalog(request);
  assert.equal(calls, 2);
  assert.equal(refreshed.data.items[0].name, "Two");

  now += 16 * 60 * 1000;
  reply = () => {
    throw new Error("offline");
  };
  const fallback = await catalogRepository.getCatalog(request);
  assert.equal(calls, 3);
  assert.equal(fallback.status, "success");
  assert.equal(fallback.data.items[0].name, "Two");
});
