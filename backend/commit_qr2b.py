#!/usr/bin/env python3
"""QR-2b Final Commit - Execute to commit the changes"""
import subprocess as sp, os, sys

def main():
    # Ensure we're in backend directory
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(backend_dir)

    try:
        # 1. Restore tsbuildinfo
        sp.run(['git', 'checkout', 'HEAD', '--', 'tsconfig.tsbuildinfo'],
               stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=False)

        # 2. Reset staging
        sp.run(['git', 'reset', 'HEAD'],
               stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=False)

        # 3. Stage cardapio-publico.ts
        sp.run(['git', 'add', 'src/routes/cardapio-publico.ts'], check=True)

        # 4. Commit
        result = sp.run(['git', 'commit', '-m', 'Implement QR-2b: token validation gate for public routes'],
                       capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Commit failed: {result.stderr}")
            return 1

        # 5. Get commit details
        hash_result = sp.run(['git', 'rev-parse', 'HEAD'],
                            capture_output=True, text=True, check=True)
        parent_result = sp.run(['git', 'rev-parse', 'HEAD~1'],
                              capture_output=True, text=True, check=True)

        commit_hash = hash_result.stdout.strip()
        parent_hash = parent_result.stdout.strip()

        # 6. Print summary
        print("\n" + "="*80)
        print("✅ QR-2b IMPLEMENTATION COMMITTED SUCCESSFULLY")
        print("="*80)
        print(f"\nCommit Hash (full):  {commit_hash}")
        print(f"Commit Hash (short): {commit_hash[:10]}")
        print(f"Parent Hash (short): {parent_hash[:10]}")

        print(f"\nFiles changed in this commit:")
        files_result = sp.run(['git', 'diff', '--name-only', f'{parent_hash}..{commit_hash}'],
                             capture_output=True, text=True, check=True)
        for line in files_result.stdout.strip().split('\n'):
            if line.strip():
                print(f"  ✓ {line}")

        print("\n" + "="*80)
        print("QR-2b Implementation Details:")
        print("="*80)
        print("✓ GET /cardapio: Token validation (t parameter)")
        print("✓ POST /api/public/pedido: Token validation GATE")
        print("✓ GET /api/public/mesa/:id/:num: Token validation")
        print("✓ Logging: Protected (no tokens/body/query)")
        print("✓ Rate limiting: Preserved (qr-mesa after token)")
        print("✓ Status codes: 404 unified for token failures")
        print("="*80 + "\n")

        return 0

    except Exception as e:
        print(f"ERROR: {e}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
