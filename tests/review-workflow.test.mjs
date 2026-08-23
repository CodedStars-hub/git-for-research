import assert from "node:assert/strict";
import test from "node:test";
import { normalizeResolutionReason } from "../src/lib/intelligence/review.ts";

test("resolution reasons preserve non-empty decisions", () => {
  assert.equal(normalizeResolutionReason("  Accepted after source review.  "), "Accepted after source review.");
});

test("an empty resolution reason remains optional", () => {
  assert.equal(normalizeResolutionReason("   "), null);
});
