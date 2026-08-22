create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete no action,
  name text not null,
  type text not null check (type in ('markdown', 'pdf', 'chat')),
  created_at timestamptz not null default now()
);

create table public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete no action,
  content_text text not null,
  content_hash text not null,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (id, artifact_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete no action,
  name text not null,
  head_commit_id uuid,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name)
);

create table public.commits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete no action,
  branch_id uuid not null,
  parent_commit_id uuid,
  merge_parent_commit_id uuid,
  message text not null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint commits_branch_workspace_fkey
    foreign key (branch_id, workspace_id)
    references public.branches (id, workspace_id) on delete no action,
  constraint commits_parent_workspace_fkey
    foreign key (parent_commit_id, workspace_id)
    references public.commits (id, workspace_id) on delete no action,
  constraint commits_merge_parent_workspace_fkey
    foreign key (merge_parent_commit_id, workspace_id)
    references public.commits (id, workspace_id) on delete no action,
  constraint commits_not_own_parent_check
    check (parent_commit_id is null or parent_commit_id <> id),
  constraint commits_not_own_merge_parent_check
    check (merge_parent_commit_id is null or merge_parent_commit_id <> id),
  constraint commits_distinct_parents_check
    check (
      parent_commit_id is null
      or merge_parent_commit_id is null
      or parent_commit_id <> merge_parent_commit_id
    )
);

alter table public.branches
  add constraint branches_head_commit_workspace_fkey
  foreign key (head_commit_id, workspace_id)
  references public.commits (id, workspace_id) on delete no action;

create table public.commit_artifacts (
  commit_id uuid not null references public.commits (id) on delete no action,
  artifact_id uuid not null references public.artifacts (id) on delete no action,
  artifact_version_id uuid not null,
  constraint commit_artifacts_version_artifact_fkey
    foreign key (artifact_version_id, artifact_id)
    references public.artifact_versions (id, artifact_id) on delete no action,
  primary key (commit_id, artifact_id)
);

create function public.validate_commit_artifact_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  commit_workspace_id uuid;
  artifact_workspace_id uuid;
begin
  select workspace_id
  into commit_workspace_id
  from public.commits
  where id = new.commit_id;

  select workspace_id
  into artifact_workspace_id
  from public.artifacts
  where id = new.artifact_id;

  if commit_workspace_id is null or artifact_workspace_id is null then
    raise exception 'Commit and artifact must both exist';
  end if;

  if commit_workspace_id <> artifact_workspace_id then
    raise exception 'Commit and artifact must belong to the same workspace';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_commit_artifact_workspace()
  from public;

create trigger validate_commit_artifact_workspace_before_write
before insert or update on public.commit_artifacts
for each row execute function public.validate_commit_artifact_workspace();

create index artifacts_workspace_id_idx on public.artifacts (workspace_id);
create index artifact_versions_artifact_id_created_at_idx
  on public.artifact_versions (artifact_id, created_at desc);
create index artifact_versions_content_hash_idx
  on public.artifact_versions (content_hash);
create index branches_workspace_id_idx on public.branches (workspace_id);
create index branches_head_commit_id_idx on public.branches (head_commit_id);
create index commits_workspace_id_created_at_idx
  on public.commits (workspace_id, created_at desc);
create index commits_branch_id_created_at_idx
  on public.commits (branch_id, created_at desc);
create index commits_parent_commit_id_idx on public.commits (parent_commit_id);
create index commits_merge_parent_commit_id_idx
  on public.commits (merge_parent_commit_id);
create index commit_artifacts_artifact_id_idx
  on public.commit_artifacts (artifact_id);
create index commit_artifacts_artifact_version_id_idx
  on public.commit_artifacts (artifact_version_id);

alter table public.workspaces enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.branches enable row level security;
alter table public.commits enable row level security;
alter table public.commit_artifacts enable row level security;

-- HACKATHON-ONLY PROTOTYPE ACCESS. These policies intentionally provide no
-- production-grade authorization. Replace them before deploying real data.
create policy "hackathon public read access to workspaces"
  on public.workspaces for select to anon, authenticated using (true);
create policy "hackathon public insert access to workspaces"
  on public.workspaces for insert to anon, authenticated with check (true);
create policy "hackathon public update access to workspaces"
  on public.workspaces for update to anon, authenticated
  using (true) with check (true);

create policy "hackathon public read access to artifacts"
  on public.artifacts for select to anon, authenticated using (true);
create policy "hackathon public insert access to artifacts"
  on public.artifacts for insert to anon, authenticated with check (true);
create policy "hackathon public update access to artifacts"
  on public.artifacts for update to anon, authenticated
  using (true) with check (true);

-- Historical records are append-only for publishable clients: SELECT and
-- INSERT are allowed, while UPDATE and DELETE have no policy or privilege.
create policy "hackathon public read access to artifact versions"
  on public.artifact_versions for select to anon, authenticated
  using (true);
create policy "hackathon public insert access to artifact versions"
  on public.artifact_versions for insert to anon, authenticated
  with check (true);

create policy "hackathon public read access to branches"
  on public.branches for select to anon, authenticated using (true);
create policy "hackathon public insert access to branches"
  on public.branches for insert to anon, authenticated with check (true);
create policy "hackathon public update access to branches"
  on public.branches for update to anon, authenticated
  using (true) with check (true);

create policy "hackathon public read access to commits"
  on public.commits for select to anon, authenticated using (true);
create policy "hackathon public insert access to commits"
  on public.commits for insert to anon, authenticated with check (true);

create policy "hackathon public read access to commit artifacts"
  on public.commit_artifacts for select to anon, authenticated using (true);
create policy "hackathon public insert access to commit artifacts"
  on public.commit_artifacts for insert to anon, authenticated with check (true);

grant usage on schema public to anon, authenticated;
revoke all privileges
  on public.workspaces, public.artifacts, public.artifact_versions,
  public.branches, public.commits, public.commit_artifacts
  from anon, authenticated;
grant select, insert
  on public.workspaces, public.artifacts, public.branches
  to anon, authenticated;
grant update (name) on public.workspaces to anon, authenticated;
grant update (name) on public.artifacts to anon, authenticated;
grant update (name, head_commit_id) on public.branches to anon, authenticated;
grant select, insert
  on public.artifact_versions, public.commits, public.commit_artifacts
  to anon, authenticated;
