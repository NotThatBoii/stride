import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDesktop } from "./platform";

const env = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
export function createOptionalSupabaseClient(
  configuredUrl?: string,
  configuredKey?: string,
  desktop = isDesktop,
): SupabaseClient | null {
  const url = configuredUrl?.trim();
  const publishableKey = configuredKey?.trim();
  if (!url || !publishableKey || publishableKey.startsWith("sb_secret_"))
    return null;
  try {
    const address = new URL(url);
    const local =
      address.protocol === "http:" &&
      (address.hostname === "localhost" || address.hostname === "127.0.0.1");
    const hosted =
      address.protocol === "https:" &&
      address.hostname === "fotgomkjwbahxmmovzmn.supabase.co" &&
      publishableKey.startsWith("sb_publishable_");
    if (
      !(local || hosted) ||
      address.username ||
      address.password ||
      address.pathname !== "/" ||
      address.search ||
      address.hash
    )
      return null;

    return createClient(address.origin, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        // Email confirmation opens the web app, not the Tauri WebView.
        detectSessionInUrl: !desktop,
        storageKey: `stride-auth-v1-${address.host}`,
      },
    });
  } catch {
    // Invalid optional configuration must never block local anonymous use.
    return null;
  }
}

// Cloud access is optional. The original anonymous workspace needs no client.
export const supabase: SupabaseClient | null = createOptionalSupabaseClient(
  env?.VITE_SUPABASE_URL,
  env?.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// The auth manager uses this only to remove a failed sign-out's persisted
// credential by key. It never reads or exposes the credential value.
export const supabaseAuthStorageKey: string | null =
  supabase && env?.VITE_SUPABASE_URL
    ? `stride-auth-v1-${new URL(env.VITE_SUPABASE_URL).host}`
    : null;
