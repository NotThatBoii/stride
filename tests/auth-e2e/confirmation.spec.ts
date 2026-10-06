import { expect, test } from "@playwright/test";
import { expectNoStudySync, mockAuth, signIn, users } from "../auth-mock";

const linkMessage =
  "This account link could not be used. It may have expired or already been opened. If you confirmed your email, sign in below. Otherwise, create your account again to request a fresh confirmation email.";

for (const source of ["hash", "query"] as const) {
  test(`failed ${source} confirmation callbacks explain recovery, hide server text and preserve unrelated URL keys`, async ({
    page,
  }) => {
    const server = await mockAuth(page);
    const failure =
      "error=access_denied&error_code=otp_expired&error_description=SELECT+private_test_marker&access_token=private_callback_token&refresh_token=private_callback_refresh";
    await page.goto(
      source === "hash"
        ? `/?from=confirmation#view=signup&${failure}`
        : `/?from=confirmation&${failure}#view=signup`,
    );
    await expect(page.getByRole("alert")).toHaveText(linkMessage);
    await expect(page.locator("body")).not.toContainText("private_test_marker");
    await expect(page.locator(".auth-screen")).toBeVisible();
    expectNoStudySync(server.calls);
    const cleaned = new URL(page.url());
    expect(cleaned.searchParams.get("from")).toBe("confirmation");
    expect(new URLSearchParams(cleaned.hash.slice(1)).get("view")).toBe(
      "signup",
    );
    expect(cleaned.searchParams.has("error")).toBe(false);
    expect(cleaned.hash).not.toContain("error");
    expect(page.url()).not.toContain("private_callback");
    // An already confirmed account can still sign in after a used/expired link.
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "What are you learning?" }),
    ).toBeVisible();
  });
}

test("a valid confirmation callback is consumed by the official SDK and restores after reload", async ({
  page,
}) => {
  await mockAuth(page);
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  // Synthetic fixture credentials are accepted only by mockAuth's isolated
  // server routes. The production app still uses the actual Auth SDK path.
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
    sub: users["first@example.test"],
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.test`;
  const callback = new URLSearchParams({
    access_token: token,
    refresh_token: `refresh-${users["first@example.test"]}`,
    expires_in: "3600",
    token_type: "bearer",
    type: "signup",
  });
  await page.goto(`/#${callback}`);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(linkMessage);
});

test("a successful query confirmation consumes credentials before cleaning the URL and never follows user redirect parameters", async ({
  page,
}) => {
  await mockAuth(page);
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: users["first@example.test"], role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  const callback = new URLSearchParams({
    access_token: token,
    refresh_token: `refresh-${users["first@example.test"]}`,
    expires_in: "3600",
    token_type: "bearer",
    type: "signup",
    from: "confirmation",
    next: "https://malicious.example/",
    redirect_to: "javascript:alert(1)",
  });
  await page.goto(`/?${callback}#/Home`);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("access_token"))
    .toBe(false);
  const cleaned = new URL(page.url());
  expect(cleaned.origin).toBe("http://127.0.0.1:1421");
  expect(cleaned.searchParams.has("refresh_token")).toBe(false);
  expect(cleaned.searchParams.get("from")).toBe("confirmation");
  expect(cleaned.searchParams.get("next")).toBe("https://malicious.example/");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
});

for (const source of ["query", "hash"] as const) {
  test(`malformed ${source} credentials are removed after SDK processing without exposing a workspace`, async ({
    page,
  }) => {
    const server = await mockAuth(page);
    const credentials =
      "access_token=private_invalid_token&refresh_token=private_invalid_refresh&expires_in=3600&token_type=bearer";
    await page.goto(
      source === "query"
        ? `/?from=confirmation&${credentials}#/Home`
        : `/?from=confirmation#view=signup&${credentials}`,
    );
    await expect(page.locator(".auth-screen")).toBeVisible();
    await expect.poll(() => page.url().includes("private_invalid")).toBe(false);
    const cleaned = new URL(page.url());
    expect(cleaned.searchParams.get("from")).toBe("confirmation");
    if (source === "query") expect(cleaned.hash).toBe("#/Home");
    else
      expect(new URLSearchParams(cleaned.hash.slice(1)).get("view")).toBe(
        "signup",
      );
    await expect(page.locator("body")).not.toContainText("private_invalid");
    await expect(page.locator(".app, .onboarding")).toHaveCount(0);
    expectNoStudySync(server.calls);
  });
}

test("failed callback parameters remain intact during delayed restoration and clean up after it settles", async ({
  page,
}) => {
  const server = await mockAuth(page, { holdRefresh: true });
  await page.goto("/");
  await signIn(page);
  await server.expireSavedSession();
  await page.evaluate(async () => {
    const { supabaseAuthStorageKey } = await import("/src/lib/supabase.ts");
    if (!supabaseAuthStorageKey) throw new Error("Missing test Auth storage.");
    const session = JSON.parse(localStorage.getItem(supabaseAuthStorageKey)!);
    session.refresh_token = "invalid-test-refresh";
    localStorage.setItem(supabaseAuthStorageKey, JSON.stringify(session));
  });
  await page.goto(
    "/?from=confirmation#error=access_denied&error_code=otp_expired&error_description=expired",
  );
  await expect
    .poll(() =>
      server.calls.some((call) => call.includes("grant_type=refresh_token")),
    )
    .toBe(true);
  await expect(page.locator(".boot")).toContainText("Opening Stride");
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  expect(
    new URLSearchParams(new URL(page.url()).hash.slice(1)).get("error_code"),
  ).toBe("otp_expired");
  server.releaseRefresh();
  await expect(page.getByRole("alert")).toHaveText(linkMessage);
  const settled = new URL(page.url());
  expect(settled.searchParams.get("from")).toBe("confirmation");
  expect(settled.hash).toBe("");
});
