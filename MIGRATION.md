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
- Frozen baseline installation passed with pnpm 9.15.9; lockfile unchanged during baseline installation.
- Added exact prerequisites from installed Expo 54.0.37 bundledNativeModules.json: expo-dev-client 6.0.21 and @expo/fingerprint 0.15.5. Added missing optional polyfill dependencies @stardazed/streams-text-encoding 1.0.2 and @ungap/structured-clone 1.3.2. Reviewed manifest/lock diff: all pre-existing direct dependency locked versions unchanged.
- Added a typecheck script. Corrected unsupported iOS symbol event props using a Pressable wrapper, corrected shared list icon props, removed an unsupported swipeable prop and two obsolete ts-expect-error comments. No restaurant flow redesign.
- `bun run typecheck` passed.
- `expo install --check` reports preserved baseline mismatches: datetimepicker 8.6.0 vs 8.4.4; RN 0.81.4 vs 0.81.5; gesture-handler 2.32.0 vs ~2.28.0; safe-area-context 5.9.1 vs ~5.6.0; SVG 15.15.5 vs 15.12.1; webview 13.17.0 vs 13.15.0. No automatic fix/runtime upgrade performed. react-leaflet also declares React 18 peers against preserved React 19.1.0; Web untested.
- Native builds and simulator interaction pending.

## Service bindings
- Existing Specular project `proj_VYBAkYDNNJQvQgPVQsU2H` is kept, not recreated.
- Imported app URL already equals the designated dev API: `https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev`. No different legacy URL was present in app.json.
- Refresh/schema and device read verification pending native launch confirmation.
- Inventory lists ASAAS_API_KEY, ASAAS_ENV, FOCUS_NFE_TOKEN and FOCUS_NFE_ENV as names only. Values were not imported; billing/fiscal integrations are unverified.
- No backend data, Git history, signing, publishing links, billing or secret values are claimed migrated. No production deployment is performed.

## Rollback
Revert migration commits to the preserved imported baseline, or reopen the untouched original project.
