# Stride v1 security and signup-consent audit

Audit started **2026-10-06**; final validation **2026-10-07** (Asia/Manila). Branch: `codex/v1-security-hardening`. Baseline: merged main `cfe69ba329521f379c7547f444af2935afd5440c`; [PR #9](https://github.com/NotThatBoii/stride/pull/9) was verified merged before work. This is a focused audit, not a new development phase or a claim of certified security.

The initial classification was completed before product changes. Main's clean baseline passed the complete existing suite. Changes address observed consent, error-redaction, callback-URL, calendar-validation and build-dependency gaps. Further adversarial review also reproduced an unbounded imported-timer allocation loop. Existing ownership, local-first behavior, conflict preservation, recovery, authentication and narrow native permissions are retained.

**SAFE TO CONTINUE v1 RELEASE** for the reviewed Windows/web/PWA scope. The complete local suite, fresh npm audits, source/history/web/PWA scans, real integration and both Windows package jobs passed. [PR #10](https://github.com/NotThatBoii/stride/pull/10) stays draft and unmerged. This report records completed validation at source/test commit `7d7f5ace280488877e7ae111428e97f6bac89a1a`; subsequent evidence-only commit checks are recorded on the PR. No hosted migration, Auth/Cloudflare configuration change, merge, tag or Release is authorized by this audit.

## Checklist

`PASS` means the reviewed boundary and tests passed, not that every possible exploit is ruled out. `MANAGED EXTERNALLY` identifies provider responsibilities. `PARTIAL` identifies concrete scope limits without manufacturing release blockers.

| # | Security item | Status | Evidence | Changes | Remaining risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Admin routes | N/A | Source, route, role and production-entry search found no application admin surface | None | Supabase Dashboard is an external privileged service |
| 2 | Server-side access control | PASS | Owner/revision/relationship/feed/receipt checks in both sync RPCs; adversarial SQL and HTTP cases | Added owner/UUID/receipt/rollback coverage | Provider/admin compromise is outside client controls |
| 3 | RLS and schema exposure | PASS | Four public and four private tables; owner reads, RPC writes; deployed anonymous reads denied and private profile rejected | Expanded actual table/role negative tests | Hosted privileged administrators retain their own access |
| 4 | Email verification and redirect flow | PASS | Hosted confirmation enabled; official SDK; fixed callback guidance; no user redirect parameter | Callback regression coverage retained/expanded | Delivery and token expiry are provider responsibilities; old manual email evidence is not a new send |
| 5 | Explicit signup agreement | FIXED | Unchecked checkbox, readable links, UI and manager exact-version/boolean guard | Required agreement before app submits signup | A custom client can bypass app UI; no durable receipt |
| 6 | Password handling | MANAGED EXTERNALLY | Passwords sent only through official Supabase Auth; no study/backup/sync password store or custom hashing | Export-separation regressions added | Supabase password policy/hash implementation; compromised OS profile |
| 7 | Client tokens | FIXED | Official SDK persistence; account-cache/export separation; callback cleanup waits for SDK initialization | Remove callback credential/error parameters after SDK settles | JS-readable SDK credentials are required by this architecture; local profile/XSS compromise remains relevant |
| 8 | Server-side secrets | PASS | Tracked source/history and production credential-pattern scans; public config only | No privileged key introduced | Pattern scans cannot prove unknown external credentials absent |
| 9 | Environment files | PASS | Ignore rules and tracked/history inventory; only `.env.example` tracked | None | Owners must keep future local/CI secrets out of commits |
| 10 | Logs and errors | FIXED | No app console/Rust logging surface; unknown Auth errors previously reached UI | Fixed Auth categories instead of raw unknown messages | Provider operational logs are outside this source audit |
| 11 | SQL injection | PASS | No user-built dynamic SQL; typed RPC arguments and qualified fixed SQL | SQL-shaped text and malformed argument tests | Future dynamic SQL needs separate review |
| 12 | Input validation | FIXED | Domain/Zod/RPC bounds; calendar overflow reproduction | Shared real-calendar check for imports and sync timestamps | Validation does not encrypt or make arbitrary user text trustworthy |
| 13 | XSS | PASS | React text rendering; no unsafe HTML/eval sink; malicious form/import/conflict/recovery strings | Four browser security scenarios; safe static legal Markdown renderer | A future HTML renderer would change the threat model |
| 14 | File/import safety | PARTIAL | Browser size/native stat checked before reading; typed envelope/relations/totals; additive staging and preserved conflicts | Bounded timer allocation; impossible-date and oversize/XSS/credential-field regressions | Existing 25 MiB cap rejects some valid text-heavy exports; measured reference 10k backup fits |
| 15 | Webhooks | N/A | No incoming webhook handler; Auth email callbacks are SDK browser callbacks | None | Any future webhook requires trusted signature/replay verification |
| 16 | Rate limiting/abuse | PARTIAL | Hosted Auth limits; bounded sync work, coalescing, exponential backoff, Retry-After | No speculative quota migration | Custom authenticated clients can consume aggregate RPC/storage quota; retries are not globally finite |
| 17 | CORS/origins | MANAGED EXTERNALLY | Supabase HTTP layer, intended Site URL, empty redirect allowlist, unchanged Cloudflare/static/Tauri policy | None | CORS/public key secrecy is not authorization; RLS/RPCs are the boundary |
| 18 | Production debugging | PASS | Production build guard and source/output scans exclude mocks/hooks/maps/debug routes | Unknown Auth diagnostics redacted | Native artifact checks and CI evidence recorded below |
| 19 | Dependencies | PARTIAL | npm advisory patched; full npm audit clean; Cargo.lock OSV review | `source-map-js` 1.2.1 → 1.2.2 only | Two non-Windows Rust transitive advisories; local Cargo tools unavailable |
| 20 | Full adversarial review | PASS | Auth, SQL, sync, local storage, web, native capabilities, supply chain and malicious backup review | Focused regression cases and cross-review | Finite source/test audit, not independent penetration testing |
| 21 | Terms of Service | FIXED | [Terms](TERMS_OF_SERVICE.md) describe the actual product and limits | Bundled readable document; no compliance promises | Product documentation; jurisdiction-specific legal review advisable |
| 22 | Data & Privacy notice | FIXED | [Existing notice](DATA_AND_PRIVACY.md) updated for actual storage/providers/export/logout behavior | Clear technical transparency, not invented tracking/business claims | Operator legal obligations need separate review |
| 23 | Legal version consistency | FIXED | Both Markdown metadata dates are `2026-10-06`; UI imports these same files | No duplicate version/text store | Changed substantive documents need a new published version |
| 24 | Durable consent evidence | NEEDS APPROVAL | [Complete schema/RPC/RLS/test/rollback proposal](proposals/CONSENT_RECORDING.md) | Three isolated SQL prototype tests, no runtime write or migration deployment | Proposed receipt is post-confirmation acknowledgment, not initial signup time |
| 25 | Consent accessibility/mobile/offline reading | PASS | Keyboard/focus/dialog naming/error association; 360/390/430 layouts; compiled cached worker offline reload | Accessible legal dialog and links in signup/account settings | Automated browser checks do not claim physical assistive-device validation |
| 26 | Windows capabilities and command surface | PASS | Main-window-only file dialogs/selected-file access; no wildcard FS, remote capabilities or custom Rust invoke | None; CSP/capabilities unchanged | Unsigned builds and OS-profile access remain documented |

Initial dispositions: existing controls were retained for access/RLS/passwords/secrets/SQL/XSS/native permissions; admin/webhooks were N/A; rate/import/Rust scope was PARTIAL; durable recording was NEEDS APPROVAL. Consent/legal text was absent, unknown Auth errors were passed through, and SDK query/failed-hash credentials could remain in the address bar. A real impossible-calendar-date acceptance and the npm advisory were reproduced before fixes.

## Threat model

An anonymous internet user or an attacker holding the public Supabase key must not read or mutate study records. A malicious authenticated user must not spoof ownership, use another user's revisions/feed/receipts, or execute private Data API functions. A valid account can still send frequent valid requests; client backoff is not a server abuse boundary.

A malicious JSON backup, remote payload or stored-XSS string must remain data, pass bounded structural/domain validation and preserve the current workspace when rejected. Conflicting edits preserve versions rather than silently choosing a winner. IDs for legacy study records remain bounded text; operation IDs and owners use server-validated UUIDs. Changing all legacy IDs to UUIDs would break valid history without improving the ownership boundary.

A stale or compromised device can retain local unsynced work and SDK session material. Logout hides the workspace immediately, preserves data and uses the official local session-revocation path plus the durable logout barrier. Account switching chooses a distinct local database. **Stride does not protect IndexedDB or SDK credentials from someone who already controls the user's Windows/browser OS profile.** Account isolation is not local encryption; readable exports also need user protection.

A malicious dependency or accidental credential commit can affect the build. The audit checks current tracked source, reachable history, production output and package metadata; CI secrets and provider administration remain privileged external boundaries. Static-cache poisoning requires control of the same-origin hosting/service-worker supply chain; the worker deliberately excludes authenticated APIs and user files.

## Actual findings

### LOW — signup did not require explicit legal agreement (fixed)

The previous signup action submitted credentials without an active Terms/privacy choice; the corresponding user-facing Terms document was absent. This was a demonstrated product/consent gap, not evidence of stolen data. Signup now requires an initially unchecked, version-specific agreement in the UI and manager before the SDK call. Legal links read the actual bundled documents without checking the box. Mode changes/reset do not carry acceptance into a later signup. Ordinary sign-in and authenticated accounts are unaffected.

Regression coverage checks missing/false/string/stale consent, default state, keyboard toggling, labels/errors, links/focus/Escape, mobile widths, existing account behavior and offline legal reading. This app-side guard does not enforce agreement for another Supabase client or provide durable evidence. The pending proposal addresses that separate scope honestly.

### LOW — unknown Auth error messages could reach the screen (fixed)

`AuthSessionManager.messageFrom` previously returned arbitrary `Error.message`. A server/SDK diagnostic containing credential-shaped text could be displayed or rethrown. No real credential exposure was found. Known public error codes/network categories now map to fixed guidance; a short exact legacy/application-message allowlist remains, and all unknown messages become generic. Tests inject credential-shaped/markup diagnostics and verify only safe text is visible/thrown. Provider logs remain outside this app-side fix.

### LOW — callback credential parameters could remain in the URL (fixed)

The installed official SDK consumes callback query/hash parameters, but its successful hash cleanup does not cover all query/failure cases. Stride previously removed only selected error parameters. Failed callbacks and query callbacks could leave sensitive SDK parameters in the address bar/history; no actual third-party disclosure was observed.

The provider now removes known credential/code/error parameters only after the official SDK `getSession()` initialization settles. A separate initialization flag prevents early Auth events or the restore timeout from racing token consumption. The logout barrier still rejects identity restoration; it does not skip SDK initialization needed for safe cleanup. Unrelated query segments/anchors remain intact. Pure URL tests and held-initialization/early-event/logout/browser callbacks cover successful consumption and safe cleanup. Cleanup cannot revoke an already compromised token or erase previously copied browser history.

### LOW — JavaScript normalized impossible written calendar dates (fixed)

`Date.parse('2026-02-31T12:00:00Z')` can normalize to March rather than reject February 31. Existing timestamp validation therefore admitted an impossible written date. Shared calendar validation now checks the written day before parsing/normalization in backups and sync. Leap years and supported legacy offset-less/offset timestamps remain valid. Tests cover subject/session/timer/export timestamps and representative legacy imports. Database validation remains authoritative for cloud writes.

### HIGH upstream / build-tool exposure — source-map-js DoS (fixed)

Dev-only transitive `source-map-js@1.2.1` entered through Vite → PostCSS. [GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) describes pathological indexed-source-map offsets causing event-loop denial of service; fixed in **1.2.2**. A crafted map reaching development/build processing is the relevant scenario; Stride's production application does not expose a source-map processing endpoint. No exploited production service or arbitrary-code-execution finding is claimed.

Only the lockfile patch entry/registry integrity changed. No forced audit fix, major upgrade or new production dependency was used. Full unit/browser/build/Windows checks validate the patch; full/prod npm audit results appear below.

### MEDIUM — tiny imported timer could cause unbounded daily allocation work (fixed)

A bounded parser-only reproduction accepted a **605-byte** backup containing a paused stopwatch interval from 2026 through 9999. Saving that timer would reach `splitSegments` and require at least **2,912,179** daily iterations on the UI thread. A second invalid epoch fixture was also accepted. The attack loop itself was not executed; acceptance and the reachable save path establish a local denial-of-service risk without risking the personal profile.

Imported timer epochs now need valid JavaScript dates, and daily allocation generation fails safely for invalid/non-advancing dates or more than **1,000 distinct days**, matching the existing cloud operation allocation budget. The parser checks the effective paused timer before accepting the backup. Ordinary multi-day/DST/countdown behavior and legacy clock semantics remain supported; there is no blanket future-time or export-time restriction. Existing damaged local timers remain loadable/exportable/discardable, and their save failures stay inside the existing action error boundary. The source backup remains untouched, and a failed save does not delete its timer. Boundary and malicious-import regressions cover rejection without a million-day test loop. This guards a real local processing path, not a new server quota.

### LOW — valid large exports can exceed the existing import budget (remaining limit)

The existing **25 MiB** pre-read cap protects phone/native memory. A representative 10,000-session backup with 100-character notes is about **5.43 MB** when formatted; the production performance round trip also measures a reference file. Conversely, 10,000 sessions with maximum 4,000-character ASCII notes produce about **44.43 MB**, and CJK/escaping can grow further. These are otherwise valid exports that cannot be imported as one file.

The cap is retained rather than increased several-fold without a bounded parser/memory design. Terms/privacy/README now explicitly state this compatibility limit and advise verifying important backups before retiring the source. The oversized browser test proves rejection before reading and preserves history; native stat-before-read coverage already exists. This is an existing capacity limitation, not a new restriction or claim that every 10k export fits.

### MEDIUM upstream / Linux-BSD scope — glib 0.18.5 unsoundness (remaining)

OSV/RustSec identifies [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) / GHSA-wrw7-89jp-8q8g, `VariantStrIter` unsoundness, patched in glib ≥0.20. This is transitive GTK/WebKit plumbing on Tauri's Linux/BSD dependency path; [the exact Tauri 2.12 manifest](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri/Cargo.toml) places that path behind target configuration. The supported Windows/WebView2 distribution has no demonstrated reachable use of this affected iterator.

No forced Rust major upgrade was made. Supporting Linux/BSD requires a fresh target-aware Cargo audit and upstream-compatible dependency plan. The OSV review is not a substitute for `cargo audit` or proof about arbitrary targets.

### INFORMATIONAL — proc-macro-error 1.0.4 unmaintained (remaining)

[RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) flags this transitive macro package as unmaintained, with no patched version stated. It is on the same GTK-related dependency chain, not evidence of a runtime exploit in Stride Windows. Track upstream replacement rather than forcing an incompatible dependency substitution.

## Database, SQL and hosted configuration evidence

| Public table | RLS | Authenticated SELECT | Anonymous SELECT | Direct INSERT / UPDATE / DELETE | Intended write path |
| --- | --- | --- | --- | --- | --- |
| `stride_subjects` | Enabled | Own rows only | Denied | Denied / denied / denied | Owner-checked sync RPC |
| `stride_sessions` | Enabled | Own rows only | Denied | Denied / denied / denied | Owner-checked sync RPC |
| `stride_allocations` | Enabled | Own rows only | Denied | Denied / denied / denied | Owner/relationship-checked sync RPC |
| `stride_preferences` | Enabled | Own rows only | Denied | Denied / denied / denied | Owner-checked sync RPC |

The four `stride_private` tables have RLS and no client table privileges. Authenticated schema USAGE and EXECUTE on the two safe private core functions are **intentional** for the public invoker wrappers. Internal helpers are denied; the private schema is not exposed through HTTP. Do not describe the safe core grants as accidental or claim that the entire schema has no grants. Qualified empty-search-path functions derive `auth.uid()` and validate revision/relationships/operation payloads. Receipts and locks are owner-scoped; the same UUID used by two accounts cannot share a receipt, and changing a frozen payload under an existing operation ID fails.

Fresh hosted **read-only** probes at **2026-10-06T10:57:41.625Z** returned Auth settings HTTP 200 with `mailer_autoconfirm=false`, email enabled and signup enabled. Zero-row anonymous selections on all four public tables returned **401 / 42501**; `Accept-Profile: stride_private` returned **406 / PGRST106**. No study records were requested. These probes complement source/isolated SQL/real local HTTP tests; they are not hosted authenticated mutation tests.

Dashboard observation on the same date showed **Confirm email on**, anonymous sign-in off, **Site URL `https://stride-89c.pages.dev`**, and **no redirect allowlist entries**. Stride does not accept a user-controlled callback destination. Existing Phase 7 owner evidence confirmed real email delivery/confirmation and reopening a used link with an already-saved session; that evidence is retained as historical manual validation, not represented as a new mail send during this audit.

Hosted Auth limits observed read-only: signup/sign-in **30 requests per 5 minutes per IP**, verification **30 per 5 minutes**, refresh **150 per 5 minutes**; IP forwarding was off. The email-send limit was not disclosed in the observation and is not asserted here. Provider limits are described in the [official Auth rate-limit documentation](https://supabase.com/docs/guides/auth/rate-limits); authenticated database APIs need their own [appropriate controls](https://supabase.com/docs/guides/api/securing-your-api).

No hosted SQL/settings save was performed. `supabase/migrations`, checked-in public/native configuration, Cloudflare headers, native CSP/capabilities, application schema and sync protocol are unchanged by this PR.

Fresh origin probes at **2026-10-06T17:52:33.011Z** (2026-10-07 Manila) found the public web response HTTP 200 with `nosniff` and `strict-origin-when-cross-origin`, without a web CSP or X-Frame-Options header. Tauri's narrow CSP is separate from web hosting. Supabase echoed an arbitrary `Origin` in its CORS response while the anonymous zero-row table request still failed **401 / 42501**. This demonstrates why origin restrictions/public-key secrecy are not the authorization boundary. Adding a web CSP/framing policy is a possible future defense-in-depth review requiring explicit approval and web/preview/PWA testing; no executing XSS was found and no production headers were changed here.

## Inputs, XSS, imports and token separation

Existing domain limits include trimmed subject name 1–80, description 500, icon 20, valid six-digit hex color; title 160 and notes 4,000 JavaScript string units; bounded legacy record IDs 1–200; finite positive durations; timestamp ordering; allocation relationship/uniqueness/totals; goal/minimum 1–1,440 minutes; up to six unique 1–1,440-minute presets; enumerated week-start/theme/mode and booleans. Timer targets are 60–86,400 seconds; up to 100k finite nonnegative, ordered intervals are supported. Backup arrays cap subjects at 10k, sessions at 100k and allocations at 300k; the file budget applies first. Search/date filters are local comparisons, not SQL/HTML. Email uses required/type-email/320-character HTML validation and trimming; signup passwords have the existing six-character minimum and authoritative Auth provider policy. The application does not add home-grown password crypto.

Timer allocation work is now bounded to 1,000 distinct recorded days per timer/session conversion. Excessive or invalid epoch values fail before imported workspace changes; the same generator also protects later timer saves.

SQL RPCs validate operation UUIDs, owner/record relationships, canonical bounded revisions/cursors, timestamps/days, payload shapes and operation bounds. SQL validation/constraint errors roll back study records, clocks, feed and receipts. A stale-revision conflict intentionally records its idempotent conflict receipt before detailed validation of the now-unneeded payload, while leaving study data/feed unchanged; this is expected protocol behavior. Legacy record IDs intentionally remain text; a SQL-shaped ID/name/note remains a literal typed argument, not executable SQL.

New malicious-browser tests exercise actual subject/session forms, JSON review/import, local SQL-backed sync/conflict content and recovery UI. Payloads include script/image/SVG markup, `javascript:` and encoded equivalents. They remain React text. Legal Markdown is static trusted repository content rendered as React nodes, with no HTML passthrough; external links allow only credential-free HTTPS and use `noopener noreferrer`. No sanitizer dependency was necessary.

Official SDK access/refresh material stays in its session persistence, not the account study database. New actual ordinary/recovery download tests compare token exclusion without printing token values. Zod strips unknown credential/prototype-shaped fields from backups. The service-worker tests verify authenticated network traffic is excluded from static caches. User-supplied secrets placed in notes are still ordinary study data and will appear in that user's readable backup; exporters cannot redact arbitrary personal text by guessing.

App-owned Auth display/throws use fixed messages. A controlled expired-session restoration fixture observed an actual refresh-error response without its diagnostic marker appearing in UI or console. This is targeted regression evidence, not a claim that every official SDK internal logging path is redacted; the SDK contains its own error logging and remains part of the dependency trust boundary.

## Abuse and approval boundaries

The server bounds each operation/page (500 change page / 1,000 allocation slices); the worker uses 100-operation batches, 100 changes/page and at most 20 pages/pull pass, with pulls before and after push. It coalesces triggers, works periodically in the foreground and applies normal jittered backoff capped at five minutes; Retry-After can require a longer wait. Transient retries are not globally finite, and successful manual sync has no fixed server-enforced cooldown. These are reliability controls; a malicious custom authenticated client can bypass them. No aggregate per-account RPC/storage quota is claimed.

No demonstrated outage or measured abusive load justifies deploying speculative quotas now. If sustained abuse appears, propose an authenticated server-side transaction quota/token bucket for the sync RPC boundary, bound feed/receipt growth with a recovery-aware retention design, measure Free-tier read/write/locking cost and import/10k compatibility, test concurrency/retries/ownership, and roll back enforcement without deleting study data. That mechanism needs a separately reviewed migration and explicit approval; none is introduced here.

Durable consent recording **does require a proposed new private table, RPC, RLS and migration**. [The proposal](proposals/CONSENT_RECORDING.md) contains exact SQL, version/time/ownership design, three isolated tests, evidence-preserving rollback and reasons to defer. It uses server receipt time, exact current versions and `auth.uid()`, without extra IP/fingerprint collection. It records a **post-confirmation authenticated acknowledgment**, since email signup has no session before confirmation. Atomic signup evidence needs a different, separately approved trusted Auth-boundary design. No Auth metadata, client ledger or automatic existing-account backfill was added. Owner must approve separately before implementation/deployment; deferring does not disable the required signup checkbox.

## Supply chain, secret scans and artifacts

The initial point-in-time scan inventoried **214 tracked files** and inspected **363 unique available reachable blobs across 38 commits**. Its narrower high-confidence expressions produced two current and four historical finding records, all known negative fixtures/documentation; **zero real credentials** were found. The 363 count describes the initial reachable blob inventory, not a claim that it was a count of eligible text blobs.

The final expanded scan inventoried **214 tracked plus 18 new nonignored files (232 total)** and scanned **197 eligible source text files**. Its available history contained **398 reachable blobs, of which 364 were eligible text blobs, across 38 commits**. Wider credential expressions produced **three current finding records comprising seven matches** and **eight historical finding records comprising 14 matches**; every match was an exact reviewed negative value at an approved fixture/documentation path. No unreviewed credential-pattern match remained. These are separate snapshots and scopes: `git rev-list --objects --all` also traverses managed checkout snapshot tree refs, so the available blob inventory can grow without additional commits. Images/binaries are not interpreted by the final text scanner.

`.env.example` remained the only tracked or reachable historical environment file. The public Supabase project URL/publishable key is intentionally embedded and is not an administrator credential. Pattern scans are finite evidence, not a promise that all unknown secrets can be identified. The sanitized final evidence is `work/security-audit/security-scan.json` (recorded 2026-10-07 at 01:51 Asia/Manila).

The initial production output had 20 files, no source maps, no test/mock/localhost request URLs and no Playwright/debug hooks. The existing build guard rejects privileged credential patterns. Final scan evidence and artifact checks are recorded after the frozen run below.

Both final **20-file** production and test PWA artifacts passed the configuration/credential guard, with **zero maps, credential patterns, mock/localhost request URLs or test hooks**. Binary/image pixels, unavailable history, personal profiles and ignored disposable credentials are outside this text scan.

Fresh full and production-only `npm audit` on 2026-10-07 Manila reported **0 critical / 0 high / 0 moderate / 0 low / 0 informational findings**.

Rust review queried **487 registry package/version pairs**, with complete OSV responses and no unconsumed pagination, on 2026-10-06T10:32:37Z. Two packages had two unique advisories (three identifiers including aliases), described above. Cargo/cargo-audit and Docker were unavailable locally. This is a read-only lockfile/OSV/manifest review, not a completed local target-aware Cargo audit.

| Package | Advisory classification | Dependency / exposure | Patched version and disposition | Upgrade risk |
| --- | --- | --- | --- | --- |
| `source-map-js` 1.2.1 | HIGH | Transitive dev/build dependency; crafted source maps | Fixed at 1.2.2 in this PR | Non-breaking lockfile patch; complete regression validation |
| `glib` 0.18.5 | MODERATE | Transitive Linux/BSD GTK runtime path | ≥0.20 upstream; Windows reachability inspected in CI | Requires compatible upstream GTK/Tauri changes; no forced major update |
| `proc-macro-error` 1.0.4 | INFORMATIONAL | Transitive GTK-related build macro, unmaintained | No patched version stated; track upstream replacement | Avoid overriding the upstream dependency chain speculatively |

GitHub workflows use PR rather than privileged `pull_request_target` execution, with contents read except the explicit tag publication job. Version-tagged third-party actions remain a supply-chain trust assumption; immutable pinning can be reviewed separately. No broad actions/hosting permission changes were made. New consent-proposal tests run in frontend CI without deployment.

The Windows job now also inspects the locked dependency tree for the supported x64 target and reports whether the two audited Rust packages are reachable. This uses Cargo already present on the runner, not a forced lockfile update or a substitute for a complete `cargo audit`. Both bundled legal Markdown files are now Windows build trigger inputs so document changes receive native CI.

Both ordinary and validation Windows jobs reported **`glib 0.18.5: False` / `proc-macro-error 1.0.4: False`** for reachability on `x86_64-pc-windows-msvc`. Their packaged frontend guards, installer/portable verification, and corrupt/incomplete-download rejection checks passed; tag publication was **skipped**. This resolves the supported-target reachability question while retaining the non-Windows advisory and complete-Cargo-audit limitations.

The ordinary [source-build artifact](https://github.com/NotThatBoii/stride/actions/runs/37507409433) (artifact 11433240213, source `d3f472a9a5efe9cef58e5cae21318154eb996e49`) was downloaded independently. GitHub ZIP digest **`193e65eb9473d11bafbcb9eee7f8517e017f94a2916b4503d061d1d8070b0c5a`** matched. The strict outer/portable ZIP entry lists, Windows x64 PE/product version 1.0.0 and both download checksums passed locally. Installer SHA-256: **`4b41be921b7cf0a35a518b4d82456b81438722dcd043b40d4668797a9dd3c144`**; portable ZIP: **`bcf4d4bf9b4421379fe40e7f78b3bc5bedb925ae85347ee145e9ad2d25625c1f`**. UTF-8/UTF-16-compatible raw-string checks found zero privileged-key/JWT/private-key/credential-URL or app-test-hook matches. The executable was **NotSigned** and **not executed or installed**; no personal profile was accessed. Compressed binary contents were not comprehensively decoded, so the CI pre-embedding frontend guard remains separate evidence. Runtime/build inputs are identical between this source artifact and the corrected integration-test head.

Read-only `npm outdated` inspection on the audit date listed 11 direct packages with newer releases: Tauri API/CLI/dialog/notification patches, Prettier and Vite patches; newer major React-plugin/Lucide/TypeScript/Vitest lines; and a newer pinned Supabase CLI. An available update is not itself a vulnerability. None of these unrelated patches/majors was needed by the advisory fix, so the tested toolchain is retained rather than upgraded wholesale.

## Baseline and final validation

| Suite | Verified merged-main baseline | Final frozen branch |
| --- | --- | --- |
| Unit | 181 passed | 197 passed |
| Release configuration/version | 6 passed | 6 passed |
| SQL/RLS contracts | 13 passed | 16 passed |
| Isolated consent proposal | Not present | 3 passed |
| Browser regression | 7 passed | 7 passed |
| Auth + missing configuration | 19 passed | 32 passed |
| Sync | 15 passed | 15 passed |
| Hardening/mobile | 6 passed | 12 passed |
| Recovery | 3 passed | 3 passed |
| Stress | 17 passed | 17 passed |
| Performance | 6 passed | 6 passed |
| Compiled PWA | 5 passed / 1 optional OS-install skipped | 6 passed / 1 optional OS-install skipped |
| Production build | Passed; intended public config and bundle guard | Passed; both guards and expanded scans |
| Frontend CI | Exact baseline CI passed | [Passed](https://github.com/NotThatBoii/stride/actions/runs/37508043377): 197 unit, 6 release, 3 proposal, build guard, 92 standard browser / 1 optional skip |
| Real Auth/PostgREST + SDK | Exact baseline CI passed: 9 TAP including parent + 6 SDK; cleanup passed | [Passed](https://github.com/NotThatBoii/stride/actions/runs/37508043287): SQL 16, HTTP 11 including parent / 10 nested, SDK 6; Auth/stack cleanup passed |
| Windows ordinary + validation builds | Exact baseline CI passed both; publication skipped | [Both passed](https://github.com/NotThatBoii/stride/actions/runs/37508043316); package/corruption guards passed; publish skipped |

The [first candidate integration run](https://github.com/NotThatBoii/stride/actions/runs/37507409403) exposed a new test transport error: plain PostgREST `eq` values were incorrectly wrapped in double quotes, so a lookup searched for literal quotes and returned no row after the writes/replays had succeeded. The fix follows the official SDK's raw `eq.${value}` plus `URLSearchParams` encoding, retaining all exact row/field/ownership assertions. That attempt passed SQL 16, nine nested HTTP scenarios and SDK 6; the tenth nested case and its parent failed. Disposable-stack cleanup succeeded. This is retained as a failed test attempt, not hidden or represented as a production SQL failure; corrected-head HTTP 11/11 and SDK 6/6 subsequently passed.

The [first frontend run](https://github.com/NotThatBoii/stride/actions/runs/37507409339) also timed out waiting for the fresh Email form before an existing backup-import scenario began. The other 14 sync cases passed; remaining suites were skipped by that failed step. Available logs did not establish the startup cause, so no application failure was inferred and no timeout/assertion was weakened. The corrected-head full frontend run passed all 15 sync cases and all following suites with unchanged runtime code. Keep this prior CI startup flake visible; reproduce with diagnostics if it recurs.

Baseline total: **78 unique browser cases passed**, including six performance cases; **72 standard browser cases**, plus one optional OS-install check skipped. Final total: **98 unique browser cases passed / 92 standard**, with the same one optional OS-install skip. A dedicated baseline performance repeat archived fresh measurements before restoring historical outputs; repeated targeted runs are not counted as new cases. Existing Phase 5/6/7 screenshots/measurements remain unchanged. The frozen run finished at 2026-10-06T17:50:51.994Z (2026-10-07 Manila). [Sanitized before/after evidence](measurements/security-v1-validation.json) records suite counts/times, all three dataset sizes, measurement hashes and read-only hosted checks; ignored `work/security-audit/` contains the complete local logs/archive.

At 10k records the freshly measured baseline had app readiness **607.6 ms**, History **360 ms**, Insights **249 ms**, warm History **35 ms**, warm Insights **48 ms**. Local SQL-backed first pull took **29,717 ms** (102 pages / 10,021 changes), incremental 100 edits **2,956 ms**, export **539 ms**, and backup-inclusive same-file import **7,120 ms** for **5,487,199 bytes**. This is production loopback/Edge with intercepted Auth/RPC and isolated SQL, not physical-phone, hosted-cloud or native timing. Compare after measurements on the same harness; a single run is not statistical proof.

| 10k reference measurement | Before | After |
| --- | --- | --- |
| App ready | 607.6 ms | 594 ms |
| History / Insights | 360 / 249 ms | 360 / 124 ms |
| Warm History / Insights | 35 / 48 ms | 41 / 39 ms |
| First pull, 102 pages / 10,021 changes | 29,717 ms | 29,845 ms |
| Incremental 100 edits | 2,956 ms | 2,949 ms |
| Export | 539 ms | 492 ms |
| Backup-inclusive same-file import | 7,120 ms | 7,321 ms |

Both runs had zero idle long tasks, unfinished sync responses and duplicate apply operations. The same 5,487,199-byte backup round-tripped 10,100 sessions/12,120 allocations. No meaningful regression is observed in this single-run comparison; timing noise is not attributed as an improvement. Bundling the legal documents/guards increases the main JS chunk from **729.10 to 752.98 kB**, gzip **212.99 to 221.47 kB** (about 4% gzip growth). The existing chunk-size warning remains informational; no new split/threshold workaround was added.

## Recommendation and remaining limits

**SAFE TO CONTINUE v1 RELEASE** for the reviewed Windows/web/PWA candidate, subject to normal owner review and green final PR checks. No demonstrated cross-account access, SQL injection, executing stored XSS, privileged credential, production secret or new native permission exposure remains. The medium local timer DoS, low consent/Auth/date gaps and high upstream build dependency advisory are fixed. All 26 checklist dispositions are recorded above: **11 PASS / 7 FIXED / 3 PARTIAL / 2 N/A / 2 MANAGED EXTERNALLY / 1 NEEDS APPROVAL / 0 BLOCKER**.

Remaining scopes are the existing text-heavy backup capacity limit, potential aggregate authenticated abuse, required official-SDK/local-profile trust, unsigned Windows builds, non-Windows Rust advisories, future web CSP/framing defense-in-depth, provider availability, jurisdiction-specific legal review and the single prior unproven CI startup flake. Physical assistive-device and native legal-dialog UI checks are not claimed; automated mobile/keyboard/offline and native build/package checks are the recorded evidence. Durable receipt recording is a separate approval decision, not a silently deployed release gate.

This audit does not merge, publish, deploy or reinterpret an app-side checkbox as durable legal evidence. Terms Version: **2026-10-06**. Privacy Version: **2026-10-06**. Durable recording: **NEEDS APPROVAL / not deployed**.
