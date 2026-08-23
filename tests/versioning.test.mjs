import assert from "node:assert/strict";
import test from "node:test";
import { diffText, mergeText } from "../src/lib/versioning/diff.ts";
import { findCommonAncestor } from "../src/lib/versioning/graph.ts";
import {
  ciCheckSetIsComplete,
  directCommitPolicy,
  mergePlanIsCurrent,
  reviewedMergeRequestIsCurrent,
  reviewHeadsAreCurrent,
} from "../src/lib/versioning/policy.ts";

test("initial commit to unborn main is allowed", () => {
  assert.deepEqual(directCommitPolicy({ name: "main", headCommitId: null }), { allowed: true, reason: null });
});

test("second direct commit to main is rejected with a branch path", () => {
  const policy = directCommitPolicy({ name: "main", headCommitId: "c1" });
  assert.equal(policy.allowed, false);
  assert.match(policy.reason, /Main is protected.*Create a branch/i);
});

test("content commits remain allowed on research branches", () => {
  assert.equal(directCommitPolicy({ name: "experiment", headCommitId: "c1" }).allowed, true);
});

test("review validity is bound to exact source and target heads", () => {
  assert.equal(reviewHeadsAreCurrent({ reviewedSourceHeadId: "c7", reviewedTargetHeadId: "c4", sourceHeadId: "c7", targetHeadId: "c4" }), true);
  assert.equal(reviewHeadsAreCurrent({ reviewedSourceHeadId: "c7", reviewedTargetHeadId: "c4", sourceHeadId: "c8", targetHeadId: "c4" }), false);
  assert.equal(reviewHeadsAreCurrent({ reviewedSourceHeadId: "c7", reviewedTargetHeadId: "c4", sourceHeadId: "c7", targetHeadId: "c5" }), false);
});

test("reviewed merge preparation is tied to the exact review and current heads", () => {
  const review = { id: "r1", sourceBranchId: "feature", targetBranchId: "main", sourceHeadId: "c3", targetHeadId: "c2", status: "open" };
  const request = { reviewId: "r1", sourceBranchId: "feature", targetBranchId: "main", sourceHeadId: "c3", targetHeadId: "c2" };
  assert.equal(reviewedMergeRequestIsCurrent(review, request, { sourceHeadId: "c3", targetHeadId: "c2" }), true);
  assert.equal(reviewedMergeRequestIsCurrent(review, request, { sourceHeadId: "c4", targetHeadId: "c2" }), false);
  assert.equal(reviewedMergeRequestIsCurrent(review, { ...request, reviewId: "r2" }, { sourceHeadId: "c3", targetHeadId: "c2" }), false);
});

test("merge requires one result for every required CI check", () => {
  const complete = [
    "textual_merge",
    "unsupported_claim",
    "numerical_change",
    "provenance",
    "possible_contradiction",
    "blast_radius",
  ];
  assert.equal(ciCheckSetIsComplete(complete), true);
  assert.equal(ciCheckSetIsComplete(complete.slice(0, -1)), false);
});

test("cached merge plans are invalidated by branch or head changes", () => {
  const plan = {
    targetBranchId: "main",
    incomingBranchId: "experiment",
    targetHeadId: "c2",
    incomingHeadId: "c3",
  };
  assert.equal(mergePlanIsCurrent(plan, plan), true);
  assert.equal(mergePlanIsCurrent(plan, { ...plan, targetHeadId: "c4" }), false);
  assert.equal(mergePlanIsCurrent(plan, { ...plan, incomingHeadId: "c5" }), false);
  assert.equal(mergePlanIsCurrent(plan, { ...plan, incomingBranchId: "other" }), false);
});

test("line diff is deterministic", () => {
  const result = diffText("one\ntwo", "one\nchanged");
  assert.deepEqual(
    result.map((chunk) => chunk.kind),
    ["unchanged", "modified"],
  );
});

test("three-way merge combines non-overlapping edits", () => {
  const result = mergeText(
    "title\nalpha\nbeta\nend",
    "new title\nalpha\nbeta\nend",
    "title\nalpha\nbeta\nnew end",
  );
  assert.equal(result.conflict, false);
  assert.equal(result.content, "new title\nalpha\nbeta\nnew end");
});

test("three-way merge reports overlapping edits", () => {
  const result = mergeText("alpha\nbeta", "alpha\nours", "alpha\ntheirs");
  assert.equal(result.conflict, true);
  assert.equal(result.content, null);
});

test("common ancestor traverses both commit parents", () => {
  const ancestor = findCommonAncestor(
    [
      { id: "c1", parent_commit_id: null, merge_parent_commit_id: null },
      { id: "c2", parent_commit_id: "c1", merge_parent_commit_id: null },
      { id: "c3", parent_commit_id: "c1", merge_parent_commit_id: null },
      { id: "c4", parent_commit_id: "c2", merge_parent_commit_id: "c3" },
      { id: "c5", parent_commit_id: "c3", merge_parent_commit_id: null },
    ],
    "c4",
    "c5",
  );
  assert.equal(ancestor, "c3");
});
