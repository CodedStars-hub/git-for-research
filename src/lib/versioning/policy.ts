export interface ProtectedBranchState {
  name: string;
  headCommitId: string | null;
}

export function directCommitPolicy(branch: ProtectedBranchState): {
  allowed: boolean;
  reason: string | null;
} {
  if (branch.name !== "main" || branch.headCommitId === null) {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: "Main is protected. Create a branch for this change.",
  };
}

export function reviewHeadsAreCurrent({
  reviewedSourceHeadId,
  reviewedTargetHeadId,
  sourceHeadId,
  targetHeadId,
}: {
  reviewedSourceHeadId: string;
  reviewedTargetHeadId: string;
  sourceHeadId: string | null;
  targetHeadId: string | null;
}): boolean {
  return (
    reviewedSourceHeadId === sourceHeadId &&
    reviewedTargetHeadId === targetHeadId
  );
}

export const REQUIRED_CI_CHECKS = [
  "textual_merge",
  "unsupported_claim",
  "numerical_change",
  "provenance",
  "possible_contradiction",
  "blast_radius",
] as const;

export function ciCheckSetIsComplete(checkTypes: Iterable<string>): boolean {
  const completed = new Set(checkTypes);
  return REQUIRED_CI_CHECKS.every((check) => completed.has(check));
}

export function reviewedMergeRequestIsCurrent(
  review: {
    id: string;
    sourceBranchId: string;
    targetBranchId: string;
    sourceHeadId: string;
    targetHeadId: string;
    status: string;
  },
  request: {
    reviewId: string;
    sourceBranchId: string;
    targetBranchId: string;
    sourceHeadId: string;
    targetHeadId: string;
  },
  current: {
    sourceHeadId: string | null;
    targetHeadId: string | null;
  },
): boolean {
  return (
    review.status === "open" &&
    review.id === request.reviewId &&
    review.sourceBranchId === request.sourceBranchId &&
    review.targetBranchId === request.targetBranchId &&
    review.sourceHeadId === request.sourceHeadId &&
    review.targetHeadId === request.targetHeadId &&
    review.sourceHeadId === current.sourceHeadId &&
    review.targetHeadId === current.targetHeadId
  );
}

export function mergePlanIsCurrent(
  plan: {
    targetBranchId: string;
    incomingBranchId: string;
    targetHeadId: string;
    incomingHeadId: string;
  },
  current: {
    targetBranchId: string;
    incomingBranchId: string;
    targetHeadId: string | null;
    incomingHeadId: string | null;
  },
): boolean {
  return (
    plan.targetBranchId === current.targetBranchId &&
    plan.incomingBranchId === current.incomingBranchId &&
    plan.targetHeadId === current.targetHeadId &&
    plan.incomingHeadId === current.incomingHeadId
  );
}
