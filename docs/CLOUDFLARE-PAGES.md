# Deploy Stride to Cloudflare Pages

Stride's web build is a static React/Vite site. Cloudflare Pages Free serves it from a `pages.dev` subdomain; study data remains in the visitor's browser in IndexedDB. Sign-in is optional. Phase 4 can connect to Supabase Auth, while study data synchronization remains disabled. The app requires no account, paid service, or service worker for local use.

## Connect the repository

1. Sign in to the Cloudflare dashboard and open **Workers & Pages**.
2. Choose **Create application → Pages → Connect to Git** and authorize Cloudflare to access `NotThatBoii/stride` in GitHub if prompted.
3. Select the repository and configure the Pages project:

   | Setting                | Value                                        |
   | ---------------------- | -------------------------------------------- |
   | Framework preset       | React (Vite)                                 |
   | Production branch      | `main`                                       |
   | Root directory         | `/` (repository root)                        |
   | Build command          | `npm ci --legacy-peer-deps && npm run build` |
   | Build output directory | `dist`                                       |

4. Save and deploy. The root `.nvmrc` selects Node.js 22 for the Pages build.
5. In **Settings → Environment variables**, add `SKIP_DEPENDENCY_INSTALL` with value `1` for both **Production** and **Preview**. This prevents Pages from running a second, implicit install; the build command performs the locked install itself.
   To enable optional accounts in the production build after Phase 4 merges, also set `VITE_SUPABASE_URL` to `https://fotgomkjwbahxmmovzmn.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` to that project's publishable key for **Production** only, then run a new deployment. See [Phase 4 Auth setup](PHASE_4_AUTH.md#local-setup). Do not set a secret or service-role key.
6. Keep the included `*.pages.dev` address as the site URL. Use a project name available in your Cloudflare account (for example, `stride` if available); Pages will show the resulting free subdomain in the project settings.

Cloudflare builds the production branch at the project's `pages.dev` address and can create preview deployments for other branches. Keep `main` as the production branch until you choose to release a change. Preview builds should leave Auth unconfigured until their redirect behavior has been deliberately tested.

## Verify a deployment

Use a fresh browser profile and the deployed HTTPS URL:

1. Open the site. The welcome screen should offer **Find your stride** and state that no account is needed. Complete onboarding without signing in.
2. Add a subject and save a study session. Reload the same `pages.dev` URL and confirm the subject and session remain in the workspace.
3. In **Settings**, choose **Export JSON**. In a clean browser profile at the same deployed URL, choose **Import JSON**, select the downloaded file, confirm **Replace and restore**, and verify the subjects and sessions appear.
4. Record the deployed URL and successful deployment commit from the Pages deployment details.

IndexedDB is scoped to the exact site origin. The deployed site, local development address, and Windows app therefore have separate workspaces; use JSON export/import to move history. Browser site-data clearing can remove that browser's records, so keep exports as backups. The Windows Tauri app and its local profile are unchanged by Pages deployment.

## Local checks

From the repository root, run:

```sh
npm ci --legacy-peer-deps
npm test
npm run build
npm run test:e2e
```

The e2e workflows use isolated browser profiles and cover anonymous onboarding, study history surviving a browser restart, and JSON export/import.

## Cloudflare references

- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Pages build image and Node.js version selection](https://developers.cloudflare.com/pages/configuration/build-image/)
- [Deploy a Vite project to Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/)
