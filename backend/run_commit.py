#!/usr/bin/env python3
"""
Execute QR-2b implementation commit
Run: python3 run_commit.py
"""
import subprocess as sp
import os

os.chdir(__file__.rsplit('/', 1)[0] if '/' in __file__ else '.')

# Restore, reset, stage
sp.run(['git', 'checkout', 'HEAD', '--', 'tsconfig.tsbuildinfo'],
       stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=False)
sp.run(['git', 'reset', 'HEAD'], stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=False)
sp.run(['git', 'add', 'src/routes/cardapio-publico.ts'], check=True)

# Commit
sp.run(['git', 'commit', '-m', 'Implement QR-2b: token validation gate for public routes'], check=True)

# Report
h = sp.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
p = sp.run(['git', 'rev-parse', 'HEAD~1'], capture_output=True, text=True, check=True).stdout.strip()

print(f"\n{'='*80}")
print("✅ QR-2b IMPLEMENTATION COMMITTED")
print(f"{'='*80}")
print(f"Commit: {h}")
print(f"Parent: {p}")
print(f"\nFiles:")
sp.run(['git', 'diff', '--name-only', f'{p}..{h}'], check=True)
print(f"{'='*80}\n")
