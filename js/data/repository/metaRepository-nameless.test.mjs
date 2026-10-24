import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
const { addonRepository } = await import("./addonRepository.js");
const { metaRepository, isNamelessMeta } = await import("./metaRepository.js");

const STUB = "https://stub.test";
const FULL = "https://full.test";

test("a named meta from a later addon wins over an id-only stub", async () => {
  addonRepository.getInstalledAddons = async () => [{ baseUrl: STUB }, { baseUrl: FULL }];
  addonRepository.resolveResourceRequestType = (_addon, _resource, type) => type;
  addonRepository.getResourceIdPrefixes = () => [];
  metaRepository.getMeta = async (baseUrl, type, id) => ({
    status: "success",
    data: metaRepository.mapMeta(baseUrl === STUB ? { id, type } : { id, type, name: "The Show" })
  });
  const result = await metaRepository.getMetaFromAllAddons("series", "tt0000001");
  assert.equal(result.status, "success");
  assert.equal(result.data.name, "The Show");
});

test("an id-only stub is still used when no addon knows the name", async () => {
  addonRepository.getInstalledAddons = async () => [{ baseUrl: STUB }];
  metaRepository.getMeta = async (_baseUrl, type, id) => ({
    status: "success",
    data: metaRepository.mapMeta({ id, type })
  });
  const result = await metaRepository.getMetaFromAllAddons("movie", "tt0000002");
  assert.equal(result.status, "success");
  assert.equal(result.data.name, "Untitled");
  assert.equal(isNamelessMeta(result.data), true);
});
