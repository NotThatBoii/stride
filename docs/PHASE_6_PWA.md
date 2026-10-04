# Phase 6 — PWA and offline app shell

Stride's hosted frontend now includes an installable web manifest, the existing Stride icon in 192 px and 512 px PNG sizes, a 180 px Apple touch icon, theme/background colors, a stable root app identity, and standalone display mode. It reuses the React application. There is no new backend or runtime dependency.

## Registration and caching boundary

`scripts/pwa.mjs` runs only during a Vite production build. It generates `sw.js` from the actual output asset list, including every lazy-loaded route chunk. A content digest covers the assets, manifest/icons, and worker policy; a change to any of these creates a new static cache version. Source maps and arbitrary public files are excluded.

`src/lib/pwa.ts` registers the worker only in a secure HTTP(S) production web context with service-worker support. Development builds, file/custom protocols, and the native Tauri platform are excluded. The native check uses the same official Tauri platform helper as existing file-dialog and notification behavior. Manifest files can be bundled with the desktop shell, but desktop does not register its web worker.

Installation downloads only the generated asset allowlist with same-origin requests and omitted credentials. Static cache entries are:

- The build's `index.html`, JS/CSS chunks, and bundled static images/fonts, when present.
- The web manifest and the four known branding files.
- A one-byte public lifecycle marker identifying an activated static shell; it contains no account, token, cursor, timer, or study data.

The fetch handler serves only exact same-origin static paths without a query string or Authorization header. Root `/` and `/index.html` navigations use the cached public HTML shell. Authentication callback query strings and other navigation paths bypass it. URL fragments are never sent with an HTTP request; the worker never records a page's fragment or rendered DOM. A previous build's known cached hashed chunks remain available during activation races.

There is no runtime response caching. Supabase origins, Auth requests/responses, sync RPCs, POST requests, arbitrary JSON responses, and private study data are never added to these caches. Account data, revisions, conflicts, timers, and pending operations remain in the existing account-scoped IndexedDB stores. Cache cleanup deletes only caches with Stride's static-shell prefix and does not access IndexedDB or authentication storage.

Failed installation deletes only its incomplete new static cache. Successful installation removes abandoned waiting builds while retaining the two most recent activated shells. Activation retains the current shell and one prior shell. This bounds completed shell caches to two after activation, or three while a replacement update waits, instead of accumulating every declined release.

Cloudflare `_headers` sets `/sw.js` to `Cache-Control: no-cache` and declares its root scope. The manifest also receives a no-cache policy and its correct content type. Worker registration uses `updateViaCache: "none"`. Tauri CSP and network permissions are unchanged by PWA work.

## Offline behavior

A successfully loaded and cached build can reopen offline, including its lazy-loaded views. A previously saved, valid account session can restore the account workspace through the existing official SDK/Auth gate. A first sign-in, confirmation callback, expired session requiring refresh, or missing account credential still needs a connection. Offline shell availability does not provide a guest workspace or bypass authentication.

Locally completed study actions use the same IndexedDB transactions and outbox as online actions. A paused timer and queued edits survive closing and reopening the page. Reconnection starts ordinary synchronization. Offline sign-out immediately hides the account and leaves the durable sign-out barrier authoritative on the next offline reload; study records stay preserved.

The browser can evict site storage or users can clear it. A service worker is not a replacement for JSON backups. The Settings card explains this and distinguishes an available shell from one still being prepared.

## Updates and installation UI

An updated worker precaches its complete build and then waits. Stride does not call `skipWaiting()` during installation and does not force-refresh an open workspace. A visible update notice offers **Reload to update** and **Later**; Settings keeps the update action available after dismissing the notice.

Reload is disabled while a local write is busy or any timer remains unsaved, including a paused timer. The user must save or discard the timer and save open edits first. The waiting worker refuses explicit activation while another Stride window is open, with a clear close-other-windows message. On acceptance it activates, and only the window that requested the update reloads. Existing IndexedDB data and pending operations are preserved. Messages and activation waits are bounded; a failure leaves a retryable message instead of an indefinitely busy update button.

The browser checks the worker during registration. Visible/online hourly checks and an explicit **Check for updates** action supplement this. A failed first registration is retried by the visible action or a later online/foreground check, so the app does not require deleting browser data to recover offline availability.

Supporting Chromium browsers can expose an **Install Stride** button through their actual `beforeinstallprompt` event. Otherwise Settings describes installation from the browser's menu/Add to Home Screen. Display-mode detection describes the current window; it does not pretend to be a universal installed-app detector.

## Automated verification

`npm run test:e2e:pwa` invokes `scripts/run-pwa-tests.mjs`. It makes a separate production build in ignored `work/pwa-build`, using only a public test configuration. A loopback-only server on port 1426 serves it. Release-marker changes exercise real worker installation/waiting/activation; no production fixture hooks or source imports are present in the built app. Auth responses are isolated fixtures and successful sync calls execute the unchanged Phase 3 SQL through PGlite, rather than the hosted service.

The locally executed standard suite passed **5 browser tests**, with **1 optional OS-installation experiment skipped**:

1. Chromium parses the manifest/icons without application installability errors; actual Auth/private/RPC/query probes never enter the static cache, and the unsigned shell reloads offline. Ordinary Playwright contexts report only Chromium's expected incognito installation prohibition.
2. Offline reopen restores the account, preserves two subjects, queued operations, and a paused timer; the timer is saved offline, reconnect transfers the subject/session, and offline sign-out stays closed after reload while IndexedDB data remains.
3. Updates wait for explicit acceptance, preserve a paused timer and unsynced rows, refuse another open window, activate only after safe conditions, replace an abandoned waiting release, and keep the static cache bound.
4. The compiled production frontend makes no worker registration/request when the native platform is detected.
5. A failed initial worker-script request recovers through **Check for updates**, without changing subjects, timers, or pending operations.

The four registration-boundary unit tests also passed locally. The production build passed; the worker adds approximately 4 KB before compression. Overall bundle and performance measurements are maintained in the main Phase 6 report because route splitting and recovery changes affect those totals.

## OS installation experiment and limits

The optional experiment is reproducible with `STRIDE_TEST_PWA_INSTALL=1` and the isolated installation test. It never opens the user's browser profile. A disposable persistent Edge profile reported no installability errors. Experimental CDP `PWA.install` and standalone-preference commands acknowledged success, but headless `PWA.launch` did not complete or expose a controllable page. Headless uninstall also returned a platform error. These acknowledgments are **not evidence of a working installed OS app**.

Cleanup reopened that exact disposable profile in headed Edge, verified its manifest identity, completed `PWA.uninstall` successfully, and confirmed `PWA.getOsAppState` reports an unknown app identity afterward. The browser closed normally. The test profile is retained in ignored `work/pwa-experiment-profile`; no user profile or personal study history was used. The standard suite skips the experiment explicitly so an unsupported experimental OS command cannot hang CI.

Windows OS installation/standalone launch, physical Android Add to Home Screen, and iOS/Safari installation remain unverified. The native Tauri packaged application has a separate validation status in the main report. No hosted PWA deployment or production service-worker behavior is claimed by this local suite; these require deployment of the reviewed branch and a hosted smoke test.

The platform behavior and manifest requirements were checked against primary documentation: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [Chromium Page manifest/installability APIs](https://chromedevtools.github.io/devtools-protocol/tot/Page/), and [Chromium experimental PWA APIs](https://chromedevtools.github.io/devtools-protocol/tot/PWA/).
