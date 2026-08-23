import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260823020000_harden_protected_repository_mutations.sql",
  import.meta.url,
);

test("security migration removes public protected-history writes", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();

  for (const policy of [
    "hackathon public insert access to branches",
    "hackathon public update access to branches",
    "hackathon public insert access to commits",
    "hackathon public insert access to commit artifacts",
    "hackathon insert research reviews",
    "hackathon update research reviews",
    "hackathon insert ci runs",
    "hackathon insert ci checks",
    "hackathon insert claims",
    "hackathon insert evidence links",
    "hackathon insert claim dependencies",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "${policy}"`));
  }

  const protectedTables = [
    "public.branches",
    "public.commits",
    "public.commit_artifacts",
    "public.claims",
    "public.evidence_links",
    "public.claim_dependencies",
    "public.research_reviews",
    "public.ci_runs",
    "public.ci_checks",
  ];
  const revokeBlock = sql.slice(
    sql.indexOf("revoke all privileges on table"),
    sql.indexOf("-- explicitly retain"),
  );
  const grantBlock = sql.slice(sql.indexOf("grant select on table"));
  assert.match(revokeBlock, /from anon, authenticated/);
  assert.match(grantBlock, /to anon, authenticated/);
  for (const table of protectedTables) {
    assert.ok(revokeBlock.includes(table), `${table} must have all public privileges revoked`);
    assert.ok(grantBlock.includes(table), `${table} must retain public SELECT`);
  }
});
