const callbackKeys = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token",
  "token_hash",
  "code",
  "code_verifier",
  "error",
  "error_code",
  "error_description",
]);

function stripParameters(raw: string): string {
  // Preserve other segments verbatim, including ordinary hash anchors. URL
  // parameter serialization would turn an anchor such as #/Home into a key.
  return raw
    .split("&")
    .filter((part) => {
      try {
        const key = decodeURIComponent(
          part.split("=", 1)[0].replace(/\+/g, " "),
        );
        return !callbackKeys.has(key);
      } catch {
        return true;
      }
    })
    .join("&");
}

// Call only after the official SDK's initialization/session request settles.
// Valid email callbacks must be consumed by the SDK before their credentials
// are removed. Neither this function nor the caller creates a session.
export function cleanedAuthCallbackUrl(href: string): string | null {
  const address = new URL(href);
  const search = stripParameters(address.search.slice(1));
  const hash = stripParameters(address.hash.slice(1));
  if (search === address.search.slice(1) && hash === address.hash.slice(1))
    return null;
  address.search = search;
  address.hash = hash;
  return address.pathname + address.search + address.hash;
}
