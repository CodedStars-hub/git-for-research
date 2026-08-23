-- Protected repository mutations are server-authoritative. This migration
-- intentionally preserves publishable SELECT access while removing writes
-- that could manufacture or advance version-control and review state.

drop policy if exists "hackathon public insert access to branches" on public.branches;
drop policy if exists "hackathon public update access to branches" on public.branches;
drop policy if exists "hackathon public insert access to commits" on public.commits;
drop policy if exists "hackathon public insert access to commit artifacts" on public.commit_artifacts;
drop policy if exists "hackathon insert research reviews" on public.research_reviews;
drop policy if exists "hackathon update research reviews" on public.research_reviews;
drop policy if exists "hackathon insert ci runs" on public.ci_runs;
drop policy if exists "hackathon insert ci checks" on public.ci_checks;
drop policy if exists "hackathon insert claims" on public.claims;
drop policy if exists "hackathon insert evidence links" on public.evidence_links;
drop policy if exists "hackathon insert claim dependencies" on public.claim_dependencies;

revoke all privileges on table
  public.branches,
  public.commits,
  public.commit_artifacts,
  public.claims,
  public.evidence_links,
  public.claim_dependencies,
  public.research_reviews,
  public.ci_runs,
  public.ci_checks
  from anon, authenticated;

-- Explicitly retain the read surface used by repository screens.
grant select on table
  public.branches,
  public.commits,
  public.commit_artifacts,
  public.claims,
  public.evidence_links,
  public.claim_dependencies,
  public.research_reviews,
  public.ci_runs,
  public.ci_checks
  to anon, authenticated;
