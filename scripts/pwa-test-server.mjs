import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

// Test-only loopback server: release markers exercise actual worker updates
// without modifying app source or introducing production fixture hooks.
const root = resolve("work/pwa-build");
let release = "A";
let workerUnavailable = false;
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:1426");
  response.setHeader("cache-control", "no-store");
  if (url.pathname === "/__test/worker" && request.method === "POST") {
    workerUnavailable = url.searchParams.get("unavailable") === "true";
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === "/sw.js" && workerUnavailable) {
    response.writeHead(503).end();
    return;
  }
  if (url.pathname === "/__test/release" && request.method === "POST") {
    release = url.searchParams.get("version") ?? "A";
    if (!/^[ABCD]$/.test(release)) {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === "/__test/private") {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ private: "STRIDE_PRIVATE_RESPONSE_SENTINEL" }),
    );
    return;
  }
  const pathname =
    url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = resolve(root, "." + pathname);
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let bytes = await readFile(file);
    if (pathname === "/index.html")
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            "</head>",
            `<meta name="stride-test-release" content="${release}"></head>`,
          ),
      );
    if (pathname === "/sw.js") {
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            /const CACHE_NAME = CACHE_PREFIX \+ "([a-f0-9]+)";/,
            `const CACHE_NAME = CACHE_PREFIX + "$1-test-${release}";`,
          ),
      );
      response.setHeader("service-worker-allowed", "/");
    }
    response.setHeader(
      "content-type",
      contentTypes[extname(file)] ?? "application/octet-stream",
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
}).listen(1426, "127.0.0.1");
