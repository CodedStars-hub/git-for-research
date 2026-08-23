import assert from "node:assert/strict";
import test from "node:test";
import { diffClaims, extractClaims, likelyContradiction, traverseDependencies } from "../src/lib/intelligence/analysis.ts";

test("claim extraction selects factual, numerical, and conclusion research statements", () => {
  const claims = extractClaims("Redis reduced database queries by 38%. The benchmark was performed under high-load conditions. Therefore, we recommend Redis for this workload. Background notes.");
  assert.deepEqual(claims.map((claim) => claim.claimType), ["numerical", "factual", "conclusion"]);
});

test("numerical claim changes are classified explicitly", () => {
  const changes = diffClaims(extractClaims("Redis reduced database queries by 28%."), extractClaims("Redis reduced database queries by 38%."), "a1", "results.md");
  assert.equal(changes.length, 1); assert.equal(changes[0].category, "numerical");
});

test("contradiction heuristic finds negation on a shared topic", () => {
  assert.equal(likelyContradiction("Architecture B is cheaper than Architecture A.", "Architecture B is not cheaper than Architecture A.").likely, true);
});

test("contradiction heuristic does not blindly flag unrelated or aligned claims", () => {
  assert.equal(likelyContradiction("Redis reduced database queries by 38%.", "The benchmark was performed under high-load conditions.").likely, false);
  assert.equal(likelyContradiction("Redis improved throughput.", "Redis improved throughput under load.").likely, false);
});

test("dependency traversal distinguishes direct and downstream impact and protects cycles", () => {
  const result = traverseDependencies(["a"], [{ sourceClaimId: "a", dependentClaimId: "b", relationship: "supports" }, { sourceClaimId: "b", dependentClaimId: "c", relationship: "supports" }, { sourceClaimId: "c", dependentClaimId: "a", relationship: "cycle" }]);
  assert.deepEqual(result, { direct: ["b"], downstream: ["c"] });
});
