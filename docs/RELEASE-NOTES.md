Stride 0.4.0 brings the indigo study workspace to Windows.

### Install

Download **Stride_0.4.0_x64-setup.exe**, run the installer, and open **Stride** from Start. No development server, Node.js, or Rust is needed. Windows 10/11 x64 only. The installer installs WebView2 if needed; that first-time runtime download requires internet access. Normal study tracking works offline.

Alternatively, extract the portable ZIP and open `stride.exe` (requires WebView2 already installed). Both editions store data in your Windows user profile.

### What's new

- Reference-inspired dark workspace with indigo highlights and geometric mountain artwork.
- Daily goal progress ring, streak summary, compact subject activity rows, and a session sidebar.
- Recent sessions open their day's records; View all opens History.
- Responsive layouts and light theme retained, alongside the web version.
- Native backup dialogs, timer recovery, and single-instance Windows behavior preserved.

### Your data

Existing desktop history remains in the same application profile. Export a backup before upgrading. To move history from the web version, use **Settings → Export JSON** there and **Settings → Import JSON** in the Windows app. Imports ask before replacing the destination data. No cloud synchronization is included.

Builds are currently unsigned, so Windows may show an unknown-publisher warning. `SHA256SUMS.txt` contains checksums for these downloads. Source is MIT licensed.
