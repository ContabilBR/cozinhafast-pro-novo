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

## Authorized Android build compatibility migration — 2026-10-14
- After repeated Android exit 42 failures, the user explicitly chose a separate migration to a supported dependency format, retaining the original lockfile and checking version changes. This supersedes the initial migration's package-manager preservation restriction for this separate compatibility step only.
- Tested Bun 1.3.14 (installed exact version). Generated root bun.lock with `bun install --lockfile-only --ignore-scripts`; Bun explicitly reported migration from pnpm-lock.yaml. Original pnpm-lock.yaml and backend/bun.lock remain untouched.
- Compared all unique package name/version pairs: 1,387 before and after; zero added, zero missing; all direct dependency versions match. Expo remains 54.0.37; React Native remains 0.81.4; original ranges and resolution override retained. This checks package versions, not equivalence of every package manager's peer layout.
- Frozen Bun installation and typecheck passed. However, build_mobile_preview refused source checkpoint: 'Legacy migration runtime changed: the original package manager or recorded version was replaced. Restore the imported baseline; stage runtime upgrades in a separate session after explicit user approval.' No iOS or Android build was submitted for this attempt, so no new native/runtime verification occurred.
- Restored package.json to pnpm@9.15.9 and reinstalled with frozen pnpm lockfile; typecheck passed again. The conversion is staged only as `migration-candidates/bun-1.3.14.lock`, NOT an active root lockfile. Requires a separate supported migration session/checkpoint approval before adopting. User approval is recorded above; do not ask for the same approval again.
- No backend/configuration/data changes. Android remains blocked by the previously recorded builder limitation; iOS was not newly verified this turn.

## Resumed migration verification — 2026-10-14
- Resumed from saved commit `efae287`; imported source remains `651f81320050abb717b8441288160b5d4de808b5`, preserved baseline `3546481`. No project replacement, dependency conversion, runtime upgrade, backend edit or data write.
- Historical `legacy-chat-history.md` attachment was not available in this resumed workspace (searched workspace and attachment directory). Previous migration notes remain the available historical reference; no credentials from history used.
- Required first specular_refresh returned HTTP 400 for the existing branch. First specular_logs returned no entries; subsequent error-log request itself returned HTTP 400. specular_status remains idle, project active, dev URL unchanged, production URL null. specular_schema succeeds. Backend sync is NOT confirmed and no replacement service was created.
- `bun run typecheck` passed before preview submission. Original active package manager is still pnpm@9.15.9; the previously authorized Bun conversion remains an inactive candidate because checkpoint guard support is unresolved. Do not repeat the blocked conversion or ask for the same authorization.
- iOS reused successful native build `xcb_23ec059a861b4199b4aeb956b919342a` for source `4e70b1fc3f98158379826e74897a48f603c3b0cc0580f38c7475141c43c9c35c`. Current leased simulator `482141AE-35A0-4303-9E63-C505E1C2908A` showed the app-owned CozinhaFast Pro login screen. Recorded walkthrough verified empty Entrar validation, one deliberate invalid-account login returning Portuguese credential error, password reveal/remask and responsive scrolling. API POST /api/login returned 401 Invalid email or password after approximately 59 seconds; backend latency remains unresolved.
- Android build `anb_c831582efe3cc898aeac310789851b918d65f890869a636c9c49ae80bb71e425` failed exit 42 before Gradle compilation: exact builder requires bun.lock, bun.lockb or package-lock.json. Android not launched. Web not tested.
- Reproduced poor dark status-bar contrast. Bounded repair adds a light status bar only to the existing dark auth screen and its loading state. No restaurant flow or animation changes. Final source recheck follows below.
- Final repair validation: typecheck and git diff --check passed; git diff against imported baseline confirmed backend/, assets/, app.json and immutable import manifest unchanged. Final source `5e92c1a0bb30ff7b3e770985533f115053f32e4aa2c92b135265ec4c73cddd44` reused iOS build `xcb_23ec059a861b4199b4aeb956b919342a` successfully. Second simulator check confirmed white readable clock, Wi-Fi and battery plus working empty Entrar validation. Cellular dots remain system dim gray; loading-state appearance not directly checked. Screenshot `/tmp/argent-artifacts/repo-37f121/20261014-114822-722/482141AE-35A0-4303-9E63-C505E1C2908A/363648000-1791978532369.png`. Final Android build `anb_3578f0f7b0ee223f7c9a68ec7d986f5dbcfbb814f6322ac3320be35a3320e46d` again failed exit 42 for required supported lockfile; no Android launch. No more identical retries attempted.
- No SecureStore entitlement error appeared in collected truncated logs; this is not proof of a fix. Secure persistence and authenticated restaurant reads remain unverified. Software keyboard did not appear during automation, so keyboard obstruction remains unchecked.
- Remaining migration gates: platform support for the preserved dependency graph or explicitly supported approved conversion checkpoint; successful backend refresh; owner-authorized authenticated read/persistence checks; billing/fiscal bindings. Imported data remains in the kept Specular backend and was neither recopied nor altered. Row completeness has not been independently verified.

## Automatic Android failure diagnosis — 2026-10-14
- First collected get_mobile_preview_logs (get_run_log is not available in this session). Available evidence is iOS native/debugger logs, truncated native snapshot and an empty React Native registry, not a full Android Gradle log. Recorded exact Android failure remains exit 42 before compilation because root pnpm-lock.yaml is unsupported by Android exact builder.
- Verified package.json still pins pnpm@9.15.9, original root lock present, approved Bun candidate inactive. Working tree clean before diagnosis; typecheck and git diff --check pass. No actionable app-code cause for Android exit 42; do not fabricate a supported lockfile or alter immutable import evidence to bypass migration protection.
- Required combined build submission/await for turn `mmv81caji6584_2`: iOS reused succeeded build `xcb_23ec059a861b4199b4aeb956b919342a`, source `08942a339bb306c596cfbc9e1e0205b54c4a5c664e1f9339be1ba2e8e99d0fb5`. Android refused further submission after 3 identical failures, paused approximately 60 seconds; no new Android build ID or emulator launch. No looped retries.
- Device inspection confirms kickoff UDID `482141AE-35A0-4303-9E63-C505E1C2908A` currently runs iOS, despite kickoff describing Android. Login screen and empty Entrar validation passed, white statusbar visible; Android remains unchecked. No sign-in or data mutation.
- First screenshot showed LogBox '[MesaCliente] Desistindo após 3 tentativas de leitura.' Code inspection traced this to getMesaClienteConfig SecureStore read retries; underlying native error was not captured. Focused second inspection found no warning overlay or registered runtime entries, so entitlement/signing cause remains unverified. No suppression or speculative secure-storage fallback applied. Screenshot `/tmp/argent-artifacts/repo-37f121/20261014-115306-1049/482141AE-35A0-4303-9E63-C505E1C2908A/333869000-1791978790348.png`.
- Resolution requires platform support for preserved pnpm graph or the already owner-approved compatible conversion checkpoint. No further approval is needed from the owner for the same conversion. App runtime, dependencies, native configuration, backend and data unchanged this turn.

## Rollback
Revert migration commits to the preserved imported baseline, or reopen the untouched original project.
