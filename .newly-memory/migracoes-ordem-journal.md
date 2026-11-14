---
name: migracoes-ordem-journal
description: Production DB is migrated from scratch; out-of-order journal timestamps break it while dev looks fine
metadata:
  node_type: memory
  type: project
  originSessionId: 95d0475b-6a0c-4688-a48f-62d61efdf91e
  modified: 2026-11-14T14:07:17.073Z
---

The 2026-11-14 production merge failed with `DROP CONSTRAINT "mesas_numero_unique" does not exist`. Cause: two hand-written migrations (20260429000000/000001) had a 2025 `when` in drizzle/meta/_journal.json. Dev, migrated step by step, skipped them because they were older than the last applied migration. A fresh production database ran them and broke the July 27 migrations. Both files are now `SELECT 1;` no-ops. A full replay on an empty PGlite database gives 0 failures and matches the latest snapshot.

**Why:** dev passing proves nothing about production. Production has never been published and runs all migrations from the start.
**How to apply:** never hand-write a migration or hand-edit `when`. Before a production merge, replay every migration on an empty PGlite database (scratch install of @electric-sql/pglite@0.2.17).
