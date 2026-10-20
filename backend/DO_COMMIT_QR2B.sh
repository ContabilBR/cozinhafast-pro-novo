#!/bin/bash
# Execute this script to commit QR-2b implementation
# cd /app/code/backend && bash DO_COMMIT_QR2B.sh

cd "$(dirname "$0")" || exit 1

git checkout HEAD -- tsconfig.tsbuildinfo 2>/dev/null || true
git reset HEAD 2>/dev/null || true
git add src/routes/cardapio-publico.ts
git commit -m "Implement QR-2b: token validation gate for public routes"

H=$(git rev-parse HEAD)
P=$(git rev-parse HEAD~1)
echo ""
echo "✅ Commit: ${H:0:10}"
echo "📍 Parent: ${P:0:10}"
git diff --name-only $P..$H
