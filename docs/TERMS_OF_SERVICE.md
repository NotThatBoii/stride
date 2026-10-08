# Terms of Service

Terms Version: 2026-10-07

These terms describe use of Stride's hosted web app, PWA and Windows app. Stride is a small independent software project maintained through [NotThatBoii/stride](https://github.com/NotThatBoii/stride). The source code's [MIT licence](https://github.com/NotThatBoii/stride/blob/main/LICENSE) remains separate; these terms do not remove rights granted by that licence.

## Stride and your account

Stride helps you organize study subjects, record completed study sessions and view your progress. An email/password account is required for a study workspace. Supabase Auth handles account authentication and email confirmation. Keep your account credentials private, use an account you are entitled to access, and protect the devices and browser profiles where you sign in.

The signup screen asks you to actively agree to these terms and acknowledge the Data & Privacy Notice before it submits account creation. Existing accounts can continue signing in. After email confirmation, Account offers a separate optional acknowledgment of the current versions. Where server recording has been enabled, an explicit choice records the server's first receipt time for that pair. It does not establish the earlier signup time or prove that a person read the documents. Signing in, opening Account or continuing study does not automatically accept changed documents, and a pending receipt does not block study access. See the Data & Privacy Notice for receipt contents, retention and limits.

## Acceptable use

Use Stride lawfully and respect other people and the service. Do not attempt to access another person's account or study records, bypass access controls, steal credentials, exploit security flaws, send malicious backups, automate abusive requests, or disrupt the hosting and synchronization services. Do not upload content you lack the right to use. Report a suspected security issue without exploiting it or publishing another person's private data.

The maintainers may restrict access or suspend an account used for abuse when permitted by applicable law. Stride currently has no self-service account-deletion screen. Contact the maintainers through the reporting mechanism below about account or data requests; keep private information out of public issues.

## Local storage, synchronization and conflicts

Study actions normally save on your device first. Subjects, completed sessions, recorded daily allocations and shared study preferences synchronize with Supabase when the account and connection allow it. Active timers, some preferences and local recovery copies stay on their device. A saved session may allow continued offline use; initial sign-in and session renewal can require a connection.

Cloud synchronization is not an immediate copy of every local action. Pending edits may still be on one device. Concurrent edits can require your choice between preserved versions, including Keep both. Check the synchronization status and finish pending work before retiring a device.

Cloudflare hosts the web app and Supabase supplies authentication and cloud storage. Temporary provider outages, service limits, network failures and maintenance can prevent sign-in or synchronization. Stride does not promise continuous service or a particular response time.

## Backups and storage limits

Keep regular JSON backups outside the app's storage, especially before upgrades, uninstalling or clearing browser data. Backups contain readable study data and notes; protect them and verify that important exports can be opened and imported before relying on them.

Clearing site data, browser storage eviction, profile deletion, device loss or selecting Delete app data during Windows uninstall can remove local history, unsynced changes, timers, settings and recovery copies. Cloud-synchronized completed history can be restored after sign-in; local-only work cannot be recovered from cloud sync alone. Ordinary uninstall currently preserves app data by default, but you should still back up first.

Imports are validated and subject to file and record limits, including a 25 MiB single-file import limit. A file can contain otherwise valid data yet be too large for one import. A backup is not an authentication or cloud-account backup. Stride cannot guarantee recovery from every crash, storage failure, malicious modification or local-data-loss scenario.

## Windows, browser and PWA limits

Windows builds require a supported Windows x64 environment and WebView2. The installer and portable app normally share the app's Windows data profile; deleting the portable executable does not make its history a portable data file. Windows builds are currently unsigned. Follow your operating system's security guidance rather than disabling protections to run software.

Browser and PWA installation, offline operation, storage persistence and notifications depend on the browser and operating system. The app must remain open for its countdown notifications. Device and browser support can change; physical iPhone validation is not claimed. See the Data & Privacy Notice for the storage model and local-access limits.

## Availability, warranties and liability

To the extent applicable law allows, the maintainers provide Stride as available without warranties that it will meet every purpose, remain uninterrupted or preserve every item of local data. To that extent, the maintainers are not responsible for indirect, incidental or consequential losses arising from use, including lost study records or disruption to study work.

Nothing here excludes liability or limits rights that applicable law does not allow to be excluded or limited. These terms do not establish regulatory compliance, certified security, end-to-end encryption or zero-knowledge storage.

## Changes

The maintainers may change Stride, its supported platforms or its service availability. Updated terms and privacy information will carry a new version identifier, with notice of material changes where practicable. Signup uses the versions displayed in that build. Existing accounts are not automatically treated as having accepted a new version merely because they sign in; any future renewed-consent process needs its own review and implementation.

## Contact and review

Use the [repository's issue tracker](https://github.com/NotThatBoii/stride/issues) for ordinary questions and bug reports. Public reports must not include passwords, tokens, authorization headers, private notes or complete backups. For a security concern, start with a minimal report asking the maintainer for a private reporting channel, without posting exploit details or private data.

This is product documentation for an independent project, not a claim of legally reviewed terms or formal legal advice. Legal review is advisable before broad public use, especially for the operator's applicable consumer, privacy and liability requirements.
