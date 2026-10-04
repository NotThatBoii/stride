import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const projectUrl = "https://fotgomkjwbahxmmovzmn.supabase.co";

export function publicBuildConfiguration(environment, fallback) {
  const url = environment.VITE_SUPABASE_URL?.trim() || fallback.url;
  const publishableKey =
    environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    fallback.publishableKey;
  if (url !== projectUrl)
    throw new Error(
      "Windows release builds require the intended Stride Supabase project.",
    );
  if (
    typeof publishableKey !== "string" ||
    !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey)
  )
    throw new Error(
      "Windows builds require a public publishable key, never a secret or service-role key.",
    );
  return { url, publishableKey };
}

export function publicBuildEnvironment(environment, configuration) {
  const result = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !/^(VITE_|SUPABASE_|STRIDE_LOCAL_SUPABASE_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(
          name,
        ),
    ),
  );
  return {
    ...result,
    VITE_SUPABASE_URL: configuration.url,
    VITE_SUPABASE_PUBLISHABLE_KEY: configuration.publishableKey,
  };
}

export async function checkPublicBundle(directory, configuration) {
  const texts = [];
  async function visit(path) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const target = join(path, file.name);
      if (file.isDirectory()) await visit(target);
      else if (/\.(js|css|html|json|webmanifest)$/.test(file.name))
        texts.push(await readFile(target, "utf8"));
    }
  }
  await visit(directory);
  const contents = texts.join("\n");
  if (
    !contents.includes(configuration.url) ||
    !contents.includes(configuration.publishableKey)
  )
    throw new Error(
      "The packaged frontend is missing its public Supabase configuration.",
    );
  if (
    /(sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}|BEGIN (?:RSA |EC )?PRIVATE KEY)/.test(
      contents,
    )
  )
    throw new Error(
      "A private credential pattern was found in the frontend. Build output is withheld.",
    );
}
