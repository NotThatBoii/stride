# Windows validation — 0.3.0

The packaged app was built from commit `95d2284bce6900da13871e44ea7394c5d2f460cc` by [Windows build 36308079339](https://github.com/NotThatBoii/stride/actions/runs/36308079339). The generated Cargo.lock is checked in to preserve the tested Rust dependency versions.

Verified on Windows on 2026-09-27 using the release `stride.exe` and an isolated WebView2 test profile:

- The executable opens its embedded application at `http://tauri.localhost/`, independently of the Vite development server.
- Onboarding creates a subject and opens the dashboard.
- Settings identifies the app as Windows desktop.
- Export JSON opens the Windows Save As dialog and writes a valid backup to the chosen path.
- Import JSON opens the Windows file picker, reads that backup, and displays the validated subject/session counts in the restore confirmation. The confirmation was canceled; shared storage restoration is covered by the automated tests.
- A second launch exits and reuses the original process/window.
- Closing and reopening the executable starts a new process and preserves the saved subject and completed onboarding.

Automated verification: 30 unit/integration tests, four browser end-to-end tests, strict TypeScript and production web build. Native boundary tests cover canceled dialogs, selected file paths, oversized imports, write failures, and notification permission handling.

The NSIS installer was compiled successfully. Interactive installation, clean-machine WebView2 bootstrap, and Windows notification toast delivery have not been manually tested. The installer and executable are unsigned. No Rust or C++ toolchain is needed to run the packaged app.
