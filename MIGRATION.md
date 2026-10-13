# CozinhaFast Pro migration

## Preserved baseline
- Legacy source revision: `651f81320050abb717b8441288160b5d4de808b5` (main, S3 copy).
- Imported baseline commit: `3546481` on dev. All inventoried file SHA-256 hashes verified before editing; zero mismatches.
- Original source and immutable import manifest remain untouched. Assets, pnpm-lock.yaml, backend/bun.lock, plugins and native configuration are preserved. No handwritten ios/ or android/ directories were inventoried.
- Declared Expo `~54.0.1`; authoritative pnpm lock resolves Expo `54.0.37`, React Native `0.81.4`, React `19.1.0`. No runtime upgrade authorized or performed.
- pnpm version was unrecorded. Migration explicitly selects `pnpm@9.15.9`, compatible with lockfile format 9.0 and Node 22 per pnpm 9 installation documentation. This is not recovery of the unknown original version. Sandbox Node: 22.23.3.
- Baseline issues: package_manager_version_unrecorded; fingerprint_missing. Development client is also absent and needed for native previews.
- Historical chat reviewed as reference only: restaurant management, Portuguese UI, role-based accounts; latest exchanges report duplicate mode-hook declarations and an unfinished five-file replacement. No remote source replacement or GitHub synchronization is performed here.

## Validation
Pending frozen installation, typecheck, native builds and simulator interaction.

## Service bindings
- Existing Specular project `proj_VYBAkYDNNJQvQgPVQsU2H` is kept, not recreated.
- Imported app URL already equals the designated dev API: `https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev`. No different legacy URL was present in app.json.
- Refresh/schema and device read verification pending native launch confirmation.
- Inventory lists ASAAS_API_KEY, ASAAS_ENV, FOCUS_NFE_TOKEN and FOCUS_NFE_ENV as names only. Values were not imported; billing/fiscal integrations are unverified.
- No backend data, Git history, signing, publishing links, billing or secret values are claimed migrated. No production deployment is performed.

## Rollback
Revert migration commits to the preserved imported baseline, or reopen the untouched original project.
