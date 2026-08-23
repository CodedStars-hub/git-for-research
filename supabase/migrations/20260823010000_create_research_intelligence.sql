-- Research intelligence records are derived from immutable committed artifact
-- versions. Historical claims and CI results are append-only.
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete no action,
  artifact_version_id uuid not null references public.artifact_versions (id) on delete no action,
  text text not null check (btrim(text) <> ''),
  claim_type text not null check (claim_type in ('factual', 'numerical', 'conclusion')),
  created_at timestamptz not null default now(),
  unique (artifact_version_id, text)
);

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete no action,
  artifact_version_id uuid not null references public.artifact_versions (id) on delete no action,
  evidence_text text not null check (btrim(evidence_text) <> ''),
  created_at timestamptz not null default now(),
  unique (claim_id, artifact_version_id, evidence_text)
);

create table public.claim_dependencies (
  id uuid primary key default gen_random_uuid(),
  source_claim_id uuid not null references public.claims (id) on delete no action,
  dependent_claim_id uuid not null references public.claims (id) on delete no action,
  relationship text not null check (btrim(relationship) <> ''),
  created_at timestamptz not null default now(),
  check (source_claim_id <> dependent_claim_id),
  unique (source_claim_id, dependent_claim_id)
);

create table public.research_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete no action,
  source_branch_id uuid not null,
  target_branch_id uuid not null,
  source_commit_id uuid not null,
  target_commit_id uuid not null,
  status text not null default 'open' check (status in ('open', 'merged', 'closed')),
  resolution_reason text,
  created_at timestamptz not null default now(),
  check (source_branch_id <> target_branch_id),
  foreign key (source_branch_id, workspace_id) references public.branches (id, workspace_id) on delete no action,
  foreign key (target_branch_id, workspace_id) references public.branches (id, workspace_id) on delete no action,
  foreign key (source_commit_id, workspace_id) references public.commits (id, workspace_id) on delete no action,
  foreign key (target_commit_id, workspace_id) references public.commits (id, workspace_id) on delete no action
);

create function public.validate_research_intelligence_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
declare expected_workspace uuid; related_workspace uuid; evidence_content text;
begin
  if tg_table_name = 'claims' then
    select a.workspace_id into expected_workspace from public.artifact_versions v join public.artifacts a on a.id = v.artifact_id where v.id = new.artifact_version_id;
    if expected_workspace is distinct from new.workspace_id then raise exception 'Claim artifact version must belong to its workspace'; end if;
  elsif tg_table_name = 'evidence_links' then
    select c.workspace_id into expected_workspace from public.claims c where c.id = new.claim_id;
    select a.workspace_id, v.content_text into related_workspace, evidence_content from public.artifact_versions v join public.artifacts a on a.id = v.artifact_id where v.id = new.artifact_version_id;
    if expected_workspace is null or expected_workspace is distinct from related_workspace then raise exception 'Evidence must belong to the claim workspace'; end if;
    if btrim(new.evidence_text) = '' then raise exception 'Evidence text must not be empty'; end if;
    if evidence_content is null then raise exception 'Evidence artifact version must exist'; end if;
    if position(lower(btrim(new.evidence_text)) in lower(evidence_content)) = 0 then raise exception 'Evidence text must occur in the referenced artifact version'; end if;
  elsif tg_table_name = 'claim_dependencies' then
    select workspace_id into expected_workspace from public.claims where id = new.source_claim_id;
    select workspace_id into related_workspace from public.claims where id = new.dependent_claim_id;
    if expected_workspace is null or expected_workspace is distinct from related_workspace then raise exception 'Dependent claims must share a workspace'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_research_intelligence_workspace() from public;
create trigger validate_claim_workspace before insert on public.claims for each row execute function public.validate_research_intelligence_workspace();
create trigger validate_evidence_workspace before insert on public.evidence_links for each row execute function public.validate_research_intelligence_workspace();
create trigger validate_dependency_workspace before insert on public.claim_dependencies for each row execute function public.validate_research_intelligence_workspace();

create table public.ci_runs (
  id uuid primary key default gen_random_uuid(),
  research_review_id uuid not null references public.research_reviews (id) on delete no action,
  status text not null check (status in ('pass', 'warning', 'fail')),
  created_at timestamptz not null default now()
);

create table public.ci_checks (
  id uuid primary key default gen_random_uuid(),
  ci_run_id uuid not null references public.ci_runs (id) on delete no action,
  check_type text not null check (check_type in ('textual_merge', 'unsupported_claim', 'numerical_change', 'provenance', 'possible_contradiction', 'blast_radius')),
  status text not null check (status in ('pass', 'warning', 'fail')),
  title text not null,
  details text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index claims_workspace_id_idx on public.claims (workspace_id);
create index claims_artifact_version_id_idx on public.claims (artifact_version_id);
create index evidence_links_claim_id_idx on public.evidence_links (claim_id);
create index evidence_links_artifact_version_id_idx on public.evidence_links (artifact_version_id);
create index claim_dependencies_source_idx on public.claim_dependencies (source_claim_id);
create index claim_dependencies_dependent_idx on public.claim_dependencies (dependent_claim_id);
create index research_reviews_workspace_created_idx on public.research_reviews (workspace_id, created_at desc);
create index research_reviews_source_branch_idx on public.research_reviews (source_branch_id);
create index research_reviews_target_branch_idx on public.research_reviews (target_branch_id);
create index research_reviews_source_commit_idx on public.research_reviews (source_commit_id);
create index research_reviews_target_commit_idx on public.research_reviews (target_commit_id);
create index ci_runs_review_created_idx on public.ci_runs (research_review_id, created_at desc);
create index ci_checks_run_idx on public.ci_checks (ci_run_id);

alter table public.claims enable row level security;
alter table public.evidence_links enable row level security;
alter table public.claim_dependencies enable row level security;
alter table public.research_reviews enable row level security;
alter table public.ci_runs enable row level security;
alter table public.ci_checks enable row level security;

-- HACKATHON-ONLY PROTOTYPE ACCESS. Replace before production use. Historical
-- intelligence records allow SELECT/INSERT only; no client DELETE policies exist.
create policy "hackathon read claims" on public.claims for select to anon, authenticated using (true);
create policy "hackathon insert claims" on public.claims for insert to anon, authenticated with check (true);
create policy "hackathon read evidence links" on public.evidence_links for select to anon, authenticated using (true);
create policy "hackathon insert evidence links" on public.evidence_links for insert to anon, authenticated with check (true);
create policy "hackathon read claim dependencies" on public.claim_dependencies for select to anon, authenticated using (true);
create policy "hackathon insert claim dependencies" on public.claim_dependencies for insert to anon, authenticated with check (true);
create policy "hackathon read research reviews" on public.research_reviews for select to anon, authenticated using (true);
create policy "hackathon insert research reviews" on public.research_reviews for insert to anon, authenticated with check (true);
create policy "hackathon update research reviews" on public.research_reviews for update to anon, authenticated using (true) with check (true);
create policy "hackathon read ci runs" on public.ci_runs for select to anon, authenticated using (true);
create policy "hackathon insert ci runs" on public.ci_runs for insert to anon, authenticated with check (true);
create policy "hackathon read ci checks" on public.ci_checks for select to anon, authenticated using (true);
create policy "hackathon insert ci checks" on public.ci_checks for insert to anon, authenticated with check (true);

revoke all privileges on public.claims, public.evidence_links, public.claim_dependencies,
  public.research_reviews, public.ci_runs, public.ci_checks from anon, authenticated;
grant select, insert on public.claims, public.evidence_links, public.claim_dependencies,
  public.research_reviews, public.ci_runs, public.ci_checks to anon, authenticated;
grant update (status, resolution_reason) on public.research_reviews to anon, authenticated;
