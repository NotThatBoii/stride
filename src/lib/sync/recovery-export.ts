import type { SyncGuard } from "./types";

const tag = (type: string, value: Record<string, unknown> = {}) => ({
  $strideRecovery: { type, ...value },
});
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 16384)
    binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(binary);
}
function preservedValue(
  value: unknown,
  blobs?: Promise<void>[],
  guard: SyncGuard = () => {},
): unknown {
  const seen = new WeakMap<object, string>();
  const encode = (current: unknown, path: string): unknown => {
    if (typeof current === "bigint")
      return tag("bigint", { value: current.toString() });
    if (current === undefined) return tag("undefined");
    if (typeof current === "number" && !Number.isFinite(current))
      return tag("number", { value: String(current) });
    if (current === null || typeof current !== "object") return current;
    const previous = seen.get(current);
    if (previous) return tag("reference", { path: previous });
    seen.set(current, path);
    if (current instanceof Date)
      return tag("date", {
        value: Number.isFinite(current.getTime())
          ? current.toISOString()
          : "Invalid Date",
      });
    if (current instanceof RegExp)
      return tag("regexp", { source: current.source, flags: current.flags });
    if (current instanceof Error)
      return tag("error", {
        name: current.name,
        message: current.message,
        stack: current.stack,
        ...(Object.prototype.hasOwnProperty.call(current, "cause")
          ? { cause: encode(current.cause, `${path}/cause`) }
          : {}),
        properties: encode(
          Object.fromEntries(Object.entries(current)),
          `${path}/properties`,
        ),
      });
    if (current instanceof ArrayBuffer)
      return tag("arraybuffer", { base64: base64(new Uint8Array(current)) });
    if (ArrayBuffer.isView(current))
      return tag("view", {
        name: current.constructor.name,
        byteOffset: current.byteOffset,
        byteLength: current.byteLength,
        buffer: encode(current.buffer, `${path}/buffer`),
      });
    if (typeof Blob !== "undefined" && current instanceof Blob) {
      const encoded = tag("blob", {
        mime: current.type,
        size: current.size,
        ...(typeof File !== "undefined" && current instanceof File
          ? { name: current.name, lastModified: current.lastModified }
          : {}),
      });
      if (blobs)
        blobs.push(
          (async () => {
            guard();
            const bytes = await current.arrayBuffer();
            guard();
            Object.assign(encoded.$strideRecovery, {
              base64: base64(new Uint8Array(bytes)),
            });
          })(),
        );
      return encoded;
    }
    if (current instanceof Map)
      return tag("map", {
        entries: [...current.entries()].map(([key, entry], i) => [
          encode(key, `${path}/entries/${i}/0`),
          encode(entry, `${path}/entries/${i}/1`),
        ]),
      });
    if (current instanceof Set)
      return tag("set", {
        values: [...current].map((entry, i) =>
          encode(entry, `${path}/values/${i}`),
        ),
      });
    if (Array.isArray(current))
      return Array.from({ length: current.length }, (_, i) =>
        i in current ? encode(current[i], `${path}/${i}`) : tag("hole"),
      );
    return Object.fromEntries(
      Object.entries(current).map(([key, entry]) => [
        key,
        encode(
          entry,
          `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        ),
      ]),
    );
  };
  return encode(value, "#");
}

// Blob-containing damaged operations are export-only. Their bytes are never
// inferred from a size/type fingerprint when authorizing a repair or retry.
export function containsRecoveryBlob(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== "object" || seen.has(current))
      continue;
    seen.add(current);
    if (typeof Blob !== "undefined" && current instanceof Blob) return true;
    if (
      current instanceof ArrayBuffer ||
      ArrayBuffer.isView(current) ||
      current instanceof Date ||
      current instanceof RegExp
    )
      continue;
    if (current instanceof Map)
      for (const [key, entry] of current) pending.push(key, entry);
    else if (current instanceof Set)
      for (const entry of current) pending.push(entry);
    else {
      for (const entry of Object.values(current)) pending.push(entry);
      if (
        current instanceof Error &&
        Object.prototype.hasOwnProperty.call(current, "cause")
      )
        pending.push(current.cause);
    }
  }
  return false;
}
export function recoveryFingerprint(value: unknown): string {
  return JSON.stringify(preservedValue(value));
}
export async function serializeRecovery(
  value: unknown,
  guard: SyncGuard = () => {},
): Promise<string> {
  guard();
  const blobs: Promise<void>[] = [];
  const encoded = preservedValue(value, blobs, guard);
  await Promise.all(blobs);
  guard();
  return JSON.stringify(encoded, null, 2);
}
