import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStillImage } from "./tvPosterRescaler.js";

const bytes = (...parts) => {
  const out = [];
  parts.forEach((part) =>
    typeof part === "string" ? out.push(...Buffer.from(part, "latin1")) : out.push(...part)
  );
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};

test("still PNG and WebP may get a WebP copy", () => {
  assert.equal(
    classifyStillImage(bytes([0x89], "PNG\r\n\x1a\n", "\0\0\0\rIHDR", "\0\0\0\0IDAT")),
    "png"
  );
  assert.equal(classifyStillImage(bytes("RIFF\0\0\0\0WEBPVP8 ")), "webp");
});

test("animated or unknown sources are left alone", () => {
  assert.equal(
    classifyStillImage(bytes([0x89], "PNG\r\n\x1a\n", "\0\0\0\bacTL", "\0\0\0\0IDAT")),
    "animated"
  );
  assert.equal(classifyStillImage(bytes("RIFF\0\0\0\0WEBPVP8X\0\0\0\0", [0x02])), "animated");
  assert.equal(classifyStillImage(bytes("GIF89a")), "animated");
  assert.equal(classifyStillImage(bytes("\0\0\0\x1cftypavif")), "unknown");
});
