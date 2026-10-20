#!/bin/bash
# QR-2b Implementation Commit Script
# This script commits ONLY backend/src/routes/cardapio-publico.ts
# Run from backend directory: bash COMMIT_QR2B.sh

set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=========================================="
echo "QR-2b Implementation - Commit Script"
echo "=========================================="

# Step 1: Restore tsbuildinfo to tracked state
echo ""
echo "Step 1: Restoring tsbuildinfo to base state..."
git checkout HEAD -- tsconfig.tsbuildinfo 2>/dev/null || echo "(No tsbuildinfo to restore)"

# Step 2: Reset staging area
echo "Step 2: Resetting staging area..."
git reset HEAD 2>/dev/null || true

# Step 3: Stage ONLY cardapio-publico.ts
echo "Step 3: Staging backend/src/routes/cardapio-publico.ts..."
git add src/routes/cardapio-publico.ts

# Step 4: Verify
echo ""
echo "Step 4: Verifying staged files:"
git diff --cached --name-only

# Step 5: Commit
echo ""
echo "Step 5: Creating commit..."
git commit -m "Implement QR-2b: token validation gate for public routes"

# Step 6: Report
echo ""
echo "=========================================="
echo "✅ COMMIT SUCCESSFUL"
echo "=========================================="

HASH=$(git rev-parse HEAD)
PARENT=$(git rev-parse HEAD~1)

echo "Commit Hash:  $HASH"
echo "Parent Hash:  $PARENT"
echo ""
echo "Files changed in this commit:"
git diff --name-only $PARENT..$HASH

echo ""
echo "Summary:"
echo "  ✓ GET /cardapio: Token validation (t parameter, shows 'QR Code invalido' when !R or !T)"
echo "  ✓ POST /api/public/pedido: Token validation gate BEFORE business logic"
echo "  ✓ GET /api/public/mesa/:id/:num: Token validation with query parameter t"
echo "  ✓ Security: Uniform 404 'Mesa nao encontrada' for token/mesa failures"
echo "  ✓ Logging: Protected (no tokens, body, query, or raw errors in logs)"
echo "  ✓ Rate limiting: qr-mesa counter increments AFTER token validation"
echo ""
echo "=========================================="

