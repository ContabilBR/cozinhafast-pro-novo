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
- Initial iOS native build succeeded: `xcb_23ec059a861b4199b4aeb956b919342a` (exact source hash `72dfcc715cd1f9837bd3fdddd62c669daeda67600a2dbf165385db9df0977fb3`).
- Android build failed before Gradle compilation, code 42: `anb_106313f4050d9e01e058839b55dbbfa41e5120f372d3eb315b72687c7fcb512b`. Builder accepts only bun.lock/bun.lockb/package-lock.json and rejects preserved pnpm graph. Infrastructure compatibility limitation; no package-manager switch authorized. Android not launched/tested. Web not tested.

## Launch confirmation
Native build `xcb_23ec059a861b4199b4aeb956b919342a` successfully launched CozinhaFast Pro on iOS simulator `62A6E63F-CA9D-4415-8EAD-DC39494F0872`. The app-owned Portuguese login screen was inspected beyond splash. Verified meaningful interaction: empty Entrar submission displays 'Preencha e-mail e senha.'; one deliberately invalid login displays 'E-mail ou senha incorretos. Tente novamente.' and remains responsive; password eye reveals/re-masks text. Runtime logs confirm POST /api/login received HTTP 401 'Invalid email or password'. No demo login, account creation or restaurant data mutation performed. Walkthrough saved in preview pane; screenshot `/tmp/argent-artifacts/repo-37f121/20261013-235750-717/62A6E63F-CA9D-4415-8EAD-DC39494F0872/298016000-1791935961307.png`.

Observed startup issue: SecureStore read reports 'A required entitlement is not present' before login loads. Session/config persistence unverified. Observed dark status icons on dark login background; software-keyboard layout untested.

## Service bindings
- Existing Specular project `proj_VYBAkYDNNJQvQgPVQsU2H` is kept, not recreated.
- Imported app URL already equals the designated dev API: `https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev`. No different legacy URL was present in app.json.
- Binding: **kept on Specular** at `https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev`. Both app.json expo.extra.backendUrl and utils/api.ts already had this exact URL in the imported baseline; no URL substitution or artificial manifest change necessary.
- After launch confirmation, specular_refresh was called once: refused because POST /branches/branch_Ck3EEJCbGwfZ9zrmXKXfK/refresh did not answer. Follow-up specular_logs returned HTTP 400. Refresh/migration sync is unconfirmed, not claimed successful. specular_status reports branch idle, project active, same dev API URL and no production URL.
- specular_schema succeeded and confirmed existing restaurant/order/inventory/auth tables. No schema edits, service recreation or data migration performed.
- Simulator API-read evidence: invalid login sent POST /api/login to the preserved dev API; runtime logs report HTTP 401 'Invalid email or password', rendered as Portuguese login error. This verifies existing API connectivity only, not successful authenticated restaurant reads or post-refresh validation.
- Inventory lists ASAAS_API_KEY, ASAAS_ENV, FOCUS_NFE_TOKEN and FOCUS_NFE_ENV as names only. Values were not imported; billing/fiscal integrations are unverified.
- No backend data, Git history, signing, publishing links, billing or secret values are claimed migrated. No production deployment is performed.

## Migration commits
- `b16aa3d`: preserved-baseline record and explicit compatible pnpm pin.
- `1f93f24`: exact preview prerequisites and bounded baseline type fixes.
- Launch/service validation is recorded in a subsequent documentation-only commit. Preview-generated .newly-native-fingerprint is not a legacy asset and is not included in the migration commits.

## Remaining limitations
- SecureStore entitlement failure was observed on the preview simulator. No signed-device entitlement identity was supplied by the build result; do not replace secure storage with insecure storage or invent a signing group. Saved sessions/table configuration remain unverified.
- Dark status-bar icons on the inherited dark login screen have poor contrast. Preserved baseline visual issue; not claimed fixed.
- Successful login, role-specific restaurant operations, saved sessions, shared list component interactions, billing, fiscal services and software-keyboard layout were not tested. No credentials recovered from history were used.
- Android builder must support the preserved pnpm lock graph for Android verification. No workaround lock or runtime upgrade was introduced.

## Rollback
Revert migration commits to the preserved imported baseline, or reopen the untouched original project.
