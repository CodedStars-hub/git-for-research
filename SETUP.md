# Supabase setup

1. Open the Supabase dashboard for your existing project.
2. Select **SQL Editor** and choose **New query**.
3. Copy the complete contents of
   `supabase/migrations/20260823000000_create_research_foundation.sql` into
   the query editor.
4. Select **Run** once.
5. Open **Table Editor** and verify that `workspaces`, `artifacts`,
   `artifact_versions`, `branches`, `commits`, and `commit_artifacts` exist.

The migration enables hackathon-only public RLS access for the publishable
client. It is not production security. Artifact versions are append-only for
the publishable client: they can be selected and inserted, but not updated or
deleted.
