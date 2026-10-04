import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "vite";

const outputPath = process.argv[2] ?? "docs/measurements/phase6-bundle.json";
const result = await build({
  logLevel: "warn",
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "https://fotgomkjwbahxmmovzmn.supabase.co",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      "sb_publishable_test_only",
    ),
  },
  build: { write: false },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(
  (bundle) => bundle.output,
);
const chunks = outputs.filter((item) => item.type === "chunk");
const groups = new Map();
const measurements = chunks.map((chunk) => {
  for (const [id, info] of Object.entries(chunk.modules)) {
    const path = relative(process.cwd(), id).replaceAll("\\", "/");
    const packageName = path.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)?.[1];
    const group =
      packageName ??
      (path.startsWith("src/") ? "application" : "runtime/virtual");
    groups.set(group, (groups.get(group) ?? 0) + info.renderedLength);
  }
  return {
    file: chunk.fileName,
    entry: chunk.isEntry,
    staticImports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code).byteLength,
    brotliBytes: brotliCompressSync(chunk.code).byteLength,
    modules: Object.entries(chunk.modules)
      .map(([id, info]) => ({
        path: relative(process.cwd(), id).replaceAll("\\", "/"),
        renderedBytesBeforeMinification: info.renderedLength,
      }))
      .sort(
        (a, b) =>
          b.renderedBytesBeforeMinification - a.renderedBytesBeforeMinification,
      ),
  };
});
const initial = new Set();
function include(file) {
  if (initial.has(file)) return;
  const chunk = chunks.find((item) => item.fileName === file);
  if (!chunk) return;
  initial.add(file);
  for (const imported of chunk.imports) include(imported);
}
for (const chunk of chunks.filter((item) => item.isEntry))
  include(chunk.fileName);
const initialChunks = measurements.filter((item) => initial.has(item.file));
await mkdir(new URL("../../docs/measurements/", import.meta.url), {
  recursive: true,
});
await writeFile(
  outputPath,
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      note: "Production minified JS sizes are exact; module/package renderedLength is BEFORE final minification and cannot be equated to compressed/minified attribution. Test-only public configuration; no code or credentials recorded.",
      initialJsBytes: initialChunks.reduce((sum, item) => sum + item.bytes, 0),
      initialJsGzipBytes: initialChunks.reduce(
        (sum, item) => sum + item.gzipBytes,
        0,
      ),
      totalJsBytes: measurements.reduce((sum, item) => sum + item.bytes, 0),
      totalJsGzipBytes: measurements.reduce(
        (sum, item) => sum + item.gzipBytes,
        0,
      ),
      assets: outputs
        .filter((item) => item.type === "asset")
        .map((item) => ({
          file: item.fileName,
          bytes: Buffer.byteLength(item.source),
          gzipBytes: gzipSync(item.source).byteLength,
        })),
      groups: [...groups]
        .map(([name, renderedBytesBeforeMinification]) => ({
          name,
          renderedBytesBeforeMinification,
        }))
        .sort(
          (a, b) =>
            b.renderedBytesBeforeMinification -
            a.renderedBytesBeforeMinification,
        ),
      chunks: measurements,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    initialJsBytes: initialChunks.reduce((sum, item) => sum + item.bytes, 0),
    chunks: chunks.length,
  }),
);
