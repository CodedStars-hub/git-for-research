<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Git for Research — Project Rules

1. Before editing code, inspect the relevant existing files first.
2. Modify only files required for the current task.
3. Do not refactor unrelated working code.
4. Do not rename routes, components, functions, database tables, or shared types unless explicitly asked.
5. Do not add dependencies unless the task truly requires them.
6. Do not modify database schema unless explicitly asked.
7. Do not hardcode core hackathon functionality or fake outputs.
8. Do not delete working functionality to simplify implementation.
9. Do not run destructive git commands or force push.
10. If a task unexpectedly requires changing many unrelated files or changing architecture, stop and explain before proceeding.
11. After every implementation task, report:

- files changed
- what was implemented
- dependencies added
- database changes
- checks run
- remaining issues

12. Always run relevant validation after implementation: lint, typecheck/build, and tests where available.
13. Never claim success if validation fails.
14. AI may assist semantic analysis, but commits, branches, version history, textual diffs, merges, and merge conflicts must remain deterministic.
15. AI must never silently decide which research claim is true.
