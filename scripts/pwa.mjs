import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicAssets = [
  "manifest.webmanifest",
  "icons/stride.svg",
  "icons/192x192.png",
  "icons/512x512.png",
  "icons/180x180.png",
];

// The build chooses every cache entry. Network responses never extend it.
export function staticShellWorker(version, paths) {
  return `
const CACHE_PREFIX = "stride-shell-v1-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const STATIC_PATHS = new Set(${JSON.stringify(paths)});
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll([...STATIC_PATHS].map((path) => new Request(path, {
        credentials: "omit", mode: "same-origin", cache: "reload"
      })));
      // Hosts can redirect /index.html to /. A followed redirect response
      // cannot satisfy a navigation request whose redirect mode is manual.
      // Preserve its static bytes and headers in a fresh, nonredirected response.
      for (const path of STATIC_PATHS) {
        const response = await cache.match(path);
        if (response?.redirected) await cache.put(path, new Response(response.body, {
          status: response.status, statusText: response.statusText, headers: response.headers
        }));
      }
      // Remove abandoned waiting builds while retaining activated shells.
      // This public lifecycle marker contains no account or study data.
      const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
      const activated = [];
      for (const name of names) {
        if (await (await caches.open(name)).match("/__stride_shell_activated__")) activated.push(name);
      }
      const keep = new Set(activated.slice(-2));
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Updates wait. Never refresh a study workspace automatically.
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await (await caches.open(CACHE_NAME)).put("/__stride_shell_activated__", new Response("1", { headers: { "content-type": "text/plain" } }));
    const previous = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    const keep = previous.at(-1);
    await Promise.all(previous.filter((name) => name !== keep).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "ACTIVATE_STRIDE_UPDATE" || event.source?.type !== "window") return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.id !== event.source.id)) {
      event.ports[0]?.postMessage({ ok: false, reason: "other_windows" });
      return;
    }
    event.ports[0]?.postMessage({ ok: true });
    await self.skipWaiting();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("authorization")) return;
  const shell = request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html");
  const path = shell ? "/index.html" : url.pathname;
  if (STATIC_PATHS.has(path)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE_NAME)).match(path);
      return cached || fetch(request);
    })());
    return;
  }
  // The prior build also contains only installed static files. Retaining its
  // hashed chunks makes an activation race safe for an already open page.
  if (/^\\/assets\\/[^/]+\\.(js|css|svg|png|webp|woff2?)$/.test(path)) {
    event.respondWith((async () => {
      for (const name of (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)) {
        const cached = await (await caches.open(name)).match(path);
        if (cached) return cached;
      }
      return fetch(request);
    })());
  }
  // No runtime cache writes, API routes, private responses, or arbitrary
  // navigation fallback (including confirmation callback query strings).
});
`;
}

export function stridePwa() {
  let publicDir;
  return {
    name: "stride-static-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      if (config.base !== "/")
        throw new Error("Stride's offline shell requires a root deployment.");
      publicDir = config.publicDir;
    },
    async generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter(
          (path) =>
            path === "index.html" ||
            /^assets\/[^/]+\.(js|css|svg|png|webp|woff2?)$/.test(path),
        )
        .sort();
      if (!files.includes("index.html"))
        throw new Error("Stride's offline shell requires index.html.");
      const paths = [...files, ...publicAssets].map((path) => `/${path}`);
      const hash = createHash("sha256").update(
        staticShellWorker("BUILD", paths),
      );
      for (const path of files) {
        const file = bundle[path];
        hash
          .update(path)
          .update(file.type === "chunk" ? file.code : file.source);
      }
      for (const path of publicAssets)
        hash.update(path).update(await readFile(resolve(publicDir, path)));
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: staticShellWorker(hash.digest("hex").slice(0, 20), paths),
      });
    },
  };
}
