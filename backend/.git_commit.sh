#!/bin/bash
set -e

cd /app/code/backend

git add src/routes/relatorios.ts
git commit -m "etapa 4d-1a: Add discount support to inconsistentesResult query"

echo "=== Commit Log ==="
git log --oneline -1

echo "=== Full SHA ==="
git rev-parse HEAD

echo "=== Git Status ==="
git status

echo "=== Diff from HEAD~1 ==="
git diff HEAD~1 --name-only
