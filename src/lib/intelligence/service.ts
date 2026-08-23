import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCommitSnapshot, prepareMerge } from "@/lib/versioning/service";
import { reviewHeadsAreCurrent } from "@/lib/versioning/policy";
import type { Branch, Claim, ClaimDependency } from "@/types/database";
import { diffClaims, extractClaims, findEvidence, likelyContradiction, tokenSimilarity, traverseDependencies, type KnowledgeChange } from "./analysis";
import type { ResearchReviewSummary, ReviewAnalysis, ReviewCheck, ReviewClaim } from "./types";
import type { CheckStatus, CiCheck, ResearchReview } from "@/types/database";
import { normalizeResolutionReason } from "./review";

const supabase = new Proxy({} as ReturnType<typeof getSupabaseAdmin>, {
  get(_target, property) {
    return Reflect.get(getSupabaseAdmin(), property, getSupabaseAdmin());
  },
});

async function branch(workspaceId: string, id: string) {
  const { data, error } = await supabase.from("branches").select("id, workspace_id, name, head_commit_id, created_at").eq("workspace_id", workspaceId).eq("id", id).single();
  if (error || !data) throw new Error("Review branch was not found.");
  if (!data.head_commit_id) throw new Error("Both review branches need a commit.");
  return data as Branch & { head_commit_id: string };
}

function commitDistance(commits: Array<{ id: string; parent_commit_id: string | null; merge_parent_commit_id: string | null }>, source: string, target: string) {
  const map = new Map(commits.map((item) => [item.id, item])); const targetAncestors = new Set<string>(); const stack = [target];
  while (stack.length) { const id = stack.pop()!; if (targetAncestors.has(id)) continue; targetAncestors.add(id); const item = map.get(id); if (item?.parent_commit_id) stack.push(item.parent_commit_id); if (item?.merge_parent_commit_id) stack.push(item.merge_parent_commit_id); }
  let count = 0; const seen = new Set<string>(); const sourceStack = [source];
  while (sourceStack.length) { const id = sourceStack.pop()!; if (seen.has(id) || targetAncestors.has(id)) continue; seen.add(id); count += 1; const item = map.get(id); if (item?.parent_commit_id) sourceStack.push(item.parent_commit_id); if (item?.merge_parent_commit_id) sourceStack.push(item.merge_parent_commit_id); }
  return count;
}

export async function analyzeBranches(workspaceId: string, sourceBranchId: string, targetBranchId: string): Promise<ReviewAnalysis> {
  const [source, target] = await Promise.all([branch(workspaceId, sourceBranchId), branch(workspaceId, targetBranchId)]);
  if (source.id === target.id) throw new Error("Choose two different branches.");
  const [sourceSnapshot, targetSnapshot, merge, commitsResult] = await Promise.all([getCommitSnapshot(workspaceId, source.head_commit_id), getCommitSnapshot(workspaceId, target.head_commit_id), prepareMerge({ workspaceId, targetBranchId, incomingBranchId: sourceBranchId }), supabase.from("commits").select("id,parent_commit_id,merge_parent_commit_id").eq("workspace_id", workspaceId)]);
  if (commitsResult.error) throw new Error(commitsResult.error.message);
  const beforeMap = new Map(targetSnapshot.map((item) => [item.artifactId, item])); const afterMap = new Map(sourceSnapshot.map((item) => [item.artifactId, item]));
  const knowledgeChanges: KnowledgeChange[] = []; const claims: ReviewClaim[] = [];
  const evidenceCandidates = sourceSnapshot.flatMap((item) => item.contentText.split(/(?<=[.!?])\s+|\n+/).map((text) => ({ artifactVersionId: item.artifactVersionId, text: text.trim() })).filter((item) => item.text.length > 15));
  for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const old = beforeMap.get(id); const next = afterMap.get(id); if (old?.contentHash === next?.contentHash) continue;
    const oldClaims = old ? extractClaims(old.contentText) : []; const newClaims = next ? extractClaims(next.contentText) : [];
    knowledgeChanges.push(...diffClaims(oldClaims, newClaims, id, next?.name ?? old?.name ?? id));
    if (next) for (const claim of newClaims) claims.push({ id: `${next.artifactVersionId}:${claims.length}`, text: claim.text, claimType: claim.claimType, artifactVersionId: next.artifactVersionId, artifactId: id, artifactName: next.name, evidence: findEvidence(claim.text, evidenceCandidates, next.artifactVersionId) });
  }
  const changedClaims = knowledgeChanges.filter((item) => item.category !== "removed");
  const relevantTexts = new Set(changedClaims.map((item) => item.after));
  const relevantClaims = claims.filter((claim) => relevantTexts.has(claim.text));
  const targetClaims = targetSnapshot.flatMap((item) => extractClaims(item.contentText).map((claim) => ({ ...claim, artifactId: item.artifactId })));
  const contradictions = changedClaims.flatMap((item) => targetClaims.filter((other) => other.text !== item.before && other.text !== item.after).map((other) => ({ item, other, result: likelyContradiction(item.after ?? "", other.text) }))).filter((item) => item.result.likely);
  const unsupported = relevantClaims.filter((claim) => !claim.evidence); const numerical = knowledgeChanges.filter((item) => item.category === "numerical");
  const checks: ReviewCheck[] = [
    { checkType: "textual_merge", status: merge.hasConflicts ? "fail" : "pass", title: merge.hasConflicts ? "Textual merge conflicts require resolution" : "Textual merge safe", details: merge.hasConflicts ? `${merge.items.filter((item) => item.status === "conflict").length} deterministic conflict(s) found.` : "Existing deterministic merge preparation found no unresolved conflict.", metadata: { conflictingArtifacts: merge.items.filter((item) => item.status === "conflict").map((item) => item.name) } },
    { checkType: "unsupported_claim", status: unsupported.length ? "warning" : "pass", title: unsupported.length ? `${unsupported.length} claim(s) need supporting evidence` : "Supporting evidence available", details: unsupported.length ? "Meaningful independent source overlap was not found. This does not mean the claims are false." : "New and modified extracted claims have a matching independent source.", metadata: { claims: unsupported.map((item) => item.text) } },
    { checkType: "numerical_change", status: numerical.length ? "warning" : "pass", title: numerical.length ? `${numerical.length} numerical change(s) need review` : "No numerical claim changes", details: numerical.length ? "Related claim wording contains changed numerical values." : "No changed numerical values were detected in related claims.", metadata: { changes: numerical } },
    { checkType: "provenance", status: relevantClaims.every((item) => item.artifactVersionId && item.artifactId) ? "pass" : "warning", title: "Claim provenance available", details: "Extracted claims retain their source artifact and immutable artifact version.", metadata: {} },
    { checkType: "possible_contradiction", status: contradictions.length ? "warning" : "pass", title: contradictions.length ? `${contradictions.length} possible contradiction(s)` : "No deterministic contradiction signal", details: contradictions.length ? "Heuristics found shared topics with negation or different numerical conclusions. Researcher review is required." : "No strong deterministic contradiction pattern was found.", metadata: { pairs: contradictions.map((item) => ({ a: item.item.after, b: item.other.text, reason: item.result.reason })) } },
  ];
  const status = checks.some((item) => item.status === "fail") ? "fail" : checks.some((item) => item.status === "warning") ? "warning" : "pass";
  return { sourceBranchId, targetBranchId, sourceBranchName: source.name, targetBranchName: target.name, sourceHeadId: source.head_commit_id, targetHeadId: target.head_commit_id, commitsChanged: commitDistance((commitsResult.data ?? []) as never[], source.head_commit_id, target.head_commit_id), artifactsChanged: new Set(knowledgeChanges.map((item) => item.artifactId)).size, knowledgeChanges, claims, checks, blastRadius: [], mergeHasConflicts: merge.hasConflicts, status };
}

export async function compareKnowledge(workspaceId: string, beforeCommitId: string, afterCommitId: string) {
  const [before, after] = await Promise.all([getCommitSnapshot(workspaceId, beforeCommitId), getCommitSnapshot(workspaceId, afterCommitId)]);
  const beforeMap = new Map(before.map((item) => [item.artifactId, item]));
  const afterMap = new Map(after.map((item) => [item.artifactId, item]));
  const changes: KnowledgeChange[] = [];
  for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const old = beforeMap.get(id); const next = afterMap.get(id);
    if (old?.contentHash === next?.contentHash) continue;
    changes.push(...diffClaims(old ? extractClaims(old.contentText) : [], next ? extractClaims(next.contentText) : [], id, next?.name ?? old?.name ?? id));
  }
  return changes;
}

async function persistCiRun(reviewId: string, workspaceId: string, analysis: ReviewAnalysis) {
  const storedClaims: Array<Claim & { artifactId: string; artifactName: string }> = [];
  for (const item of analysis.claims) {
    const fields = "id,workspace_id,artifact_version_id,text,claim_type,created_at";
    const existing = await supabase.from("claims").select(fields).eq("artifact_version_id", item.artifactVersionId).eq("text", item.text).maybeSingle();
    if (existing.error) throw new Error(`Could not read claims: ${existing.error.message}`);
    const created = existing.data ? existing : await supabase.from("claims").insert({ workspace_id: workspaceId, artifact_version_id: item.artifactVersionId, text: item.text, claim_type: item.claimType }).select(fields).single();
    if (created.error || !created.data) throw new Error(`Could not persist claims: ${created.error?.message ?? "No claim returned."}`); const claim = created.data as Claim;
    storedClaims.push({ ...claim, artifactId: item.artifactId, artifactName: item.artifactName });
    if (item.evidence) { const { error: evidenceError } = await supabase.from("evidence_links").upsert({ claim_id: claim.id, artifact_version_id: item.evidence.artifactVersionId, evidence_text: item.evidence.text }, { onConflict: "claim_id,artifact_version_id,evidence_text", ignoreDuplicates: true }); if (evidenceError) throw new Error(evidenceError.message); }
  }
  const dependencyRows: Array<{ source_claim_id: string; dependent_claim_id: string; relationship: string }> = [];
  for (const source of storedClaims) for (const dependent of storedClaims) if (source.id !== dependent.id && dependent.claim_type === "conclusion" && tokenSimilarity(source.text, dependent.text) >= 0.45) dependencyRows.push({ source_claim_id: source.id, dependent_claim_id: dependent.id, relationship: "deterministic meaningful-token overlap" });
  if (dependencyRows.length) { const { error } = await supabase.from("claim_dependencies").upsert(dependencyRows, { onConflict: "source_claim_id,dependent_claim_id", ignoreDuplicates: true }); if (error) throw new Error(error.message); }
  const { data: dependencies } = await supabase.from("claim_dependencies").select("id,source_claim_id,dependent_claim_id,relationship,created_at").in("source_claim_id", storedClaims.map((item) => item.id));
  const changedIds = storedClaims.filter((claim) => analysis.knowledgeChanges.some((change) => change.after === claim.text)).map((claim) => claim.id);
  const impact = traverseDependencies(changedIds, ((dependencies ?? []) as ClaimDependency[]).map((edge) => ({ sourceClaimId: edge.source_claim_id, dependentClaimId: edge.dependent_claim_id, relationship: edge.relationship })));
  const claimMap = new Map(storedClaims.map((claim) => [claim.id, claim.text]));
  analysis.blastRadius = changedIds.map((id) => ({ sourceClaim: claimMap.get(id) ?? id, direct: impact.direct.map((value) => claimMap.get(value) ?? value), downstream: impact.downstream.map((value) => claimMap.get(value) ?? value) })).filter((item) => item.direct.length || item.downstream.length);
  analysis.checks.push({ checkType: "blast_radius", status: analysis.blastRadius.length ? "warning" : "pass", title: analysis.blastRadius.length ? "Downstream conclusions may require review" : "No stored downstream impact", details: analysis.blastRadius.length ? "Actual stored claim relationships were traversed with cycle protection." : "No affected stored dependency relationship was found.", metadata: { blastRadius: analysis.blastRadius } });
  analysis.status = analysis.checks.some((item) => item.status === "fail") ? "fail" : analysis.checks.some((item) => item.status === "warning") ? "warning" : "pass";
  const { data: run, error: runError } = await supabase.from("ci_runs").insert({ research_review_id: reviewId, status: analysis.status }).select("id").single(); if (runError) throw new Error(runError.message);
  const { error: checkError } = await supabase.from("ci_checks").insert(analysis.checks.map((check) => ({ ci_run_id: run.id, check_type: check.checkType, status: check.status, title: check.title, details: check.details, metadata: check.metadata }))); if (checkError) throw new Error(checkError.message);
  return { ...analysis, reviewId, ciRunId: run.id };
}

export async function createReview(workspaceId: string, sourceBranchId: string, targetBranchId: string) {
  const analysis = await analyzeBranches(workspaceId, sourceBranchId, targetBranchId);
  const { data: review, error: reviewError } = await supabase.from("research_reviews").insert({ workspace_id: workspaceId, source_branch_id: sourceBranchId, target_branch_id: targetBranchId, source_commit_id: analysis.sourceHeadId, target_commit_id: analysis.targetHeadId, status: "open" }).select("id").single();
  if (reviewError) throw new Error(`Could not create review: ${reviewError.message}`);
  return persistCiRun(review.id, workspaceId, analysis);
}

export async function rerunReviewCi(reviewId: string) {
  const { data, error } = await supabase.from("research_reviews").select("id,workspace_id,source_branch_id,target_branch_id,source_commit_id,target_commit_id,status,resolution_reason,created_at").eq("id", reviewId).eq("status", "open").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Create a Research Review first.");
  const review = data as ResearchReview;
  const [source, target] = await Promise.all([branch(review.workspace_id, review.source_branch_id), branch(review.workspace_id, review.target_branch_id)]);
  if (!reviewHeadsAreCurrent({ reviewedSourceHeadId: review.source_commit_id, reviewedTargetHeadId: review.target_commit_id, sourceHeadId: source.head_commit_id, targetHeadId: target.head_commit_id })) {
    throw new Error("Research Review is out of date. Refresh the review before merging.");
  }
  const analysis = await analyzeBranches(review.workspace_id, review.source_branch_id, review.target_branch_id);
  return persistCiRun(review.id, review.workspace_id, analysis);
}

export async function listReviews(workspaceId: string) {
  const [{ data, error }, branchesResult] = await Promise.all([
    supabase.from("research_reviews").select("id,workspace_id,source_branch_id,target_branch_id,source_commit_id,target_commit_id,status,resolution_reason,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("branches").select("id,name,head_commit_id").eq("workspace_id", workspaceId),
  ]);
  if (error) throw new Error(error.message);
  if (branchesResult.error) throw new Error(branchesResult.error.message);
  const branchMap = new Map((branchesResult.data ?? []).map((item) => [item.id, item]));
  const reviews = (data ?? []) as ResearchReview[];
  const reviewIds = reviews.map((review) => review.id);
  const runsResult = reviewIds.length
    ? await supabase
        .from("ci_runs")
        .select("id,research_review_id,status,created_at")
        .in("research_review_id", reviewIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (runsResult.error) throw new Error(runsResult.error.message);
  const latestRunByReview = new Map<string, { id: string; status: CheckStatus }>();
  for (const run of runsResult.data ?? []) {
    if (!latestRunByReview.has(run.research_review_id)) {
      latestRunByReview.set(run.research_review_id, {
        id: run.id,
        status: run.status as CheckStatus,
      });
    }
  }
  const summaries: ResearchReviewSummary[] = [];
  for (const review of reviews) {
    const source = branchMap.get(review.source_branch_id);
    const target = branchMap.get(review.target_branch_id);
    const run = latestRunByReview.get(review.id);
    summaries.push({
      ...review,
      sourceBranchName: source?.name ?? review.source_branch_id.slice(0, 8),
      targetBranchName: target?.name ?? review.target_branch_id.slice(0, 8),
      currentSourceHeadId: source?.head_commit_id ?? null,
      currentTargetHeadId: target?.head_commit_id ?? null,
      stale: !reviewHeadsAreCurrent({ reviewedSourceHeadId: review.source_commit_id, reviewedTargetHeadId: review.target_commit_id, sourceHeadId: source?.head_commit_id ?? null, targetHeadId: target?.head_commit_id ?? null }),
      ciStatus: (run?.status as CheckStatus | undefined) ?? null,
      ciRunId: run?.id ?? null,
    });
  }
  return summaries;
}

export async function loadReview(reviewId: string): Promise<ReviewAnalysis> {
  const { data, error } = await supabase.from("research_reviews").select("id,workspace_id,source_branch_id,target_branch_id,source_commit_id,target_commit_id,status,resolution_reason,created_at").eq("id", reviewId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Research Review was not found.");
  const review = data as ResearchReview;
  const [source, target] = await Promise.all([branch(review.workspace_id, review.source_branch_id), branch(review.workspace_id, review.target_branch_id)]);
  if (!reviewHeadsAreCurrent({ reviewedSourceHeadId: review.source_commit_id, reviewedTargetHeadId: review.target_commit_id, sourceHeadId: source.head_commit_id, targetHeadId: target.head_commit_id })) {
    throw new Error("Research Review is out of date. Refresh the review before merging.");
  }
  const analysis = await analyzeBranches(review.workspace_id, review.source_branch_id, review.target_branch_id);
  const { data: run, error: runError } = await supabase.from("ci_runs").select("id,status").eq("research_review_id", review.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("Research CI has not run for this review.");
  const { data: checks, error: checkError } = await supabase.from("ci_checks").select("id,ci_run_id,check_type,status,title,details,metadata,created_at").eq("ci_run_id", run.id);
  if (checkError) throw new Error(checkError.message);
  analysis.checks = ((checks ?? []) as CiCheck[]).map((check) => ({ checkType: check.check_type, status: check.status, title: check.title, details: check.details, metadata: check.metadata }));
  const blast = analysis.checks.find((check) => check.checkType === "blast_radius")?.metadata.blastRadius;
  if (Array.isArray(blast)) analysis.blastRadius = blast as ReviewAnalysis["blastRadius"];
  analysis.status = run.status as CheckStatus;
  return { ...analysis, reviewId: review.id, ciRunId: run.id, resolutionReason: review.resolution_reason };
}

export async function recordResolutionReason(reviewId: string, reason: string) {
  const normalized = normalizeResolutionReason(reason);
  const { data, error } = await supabase
    .from("research_reviews")
    .update({ resolution_reason: normalized })
    .eq("id", reviewId)
    .eq("status", "open")
    .select("resolution_reason")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The current Research Review could not be updated.");
  return data.resolution_reason as string | null;
}
