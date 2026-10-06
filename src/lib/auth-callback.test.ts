import { describe, expect, it } from "vitest";
import { cleanedAuthCallbackUrl } from "./auth-callback";

describe("post-initialization callback cleanup", () => {
  it("removes all callback secrets/errors from both query and hash while retaining unrelated encoded segments", () => {
    const value = cleanedAuthCallbackUrl(
      "https://stride.test/?from=email%20confirmation&access_token=private&refresh_token=private&code=private&token_hash=private#error_description=private&provider_token=private&provider_refresh_token=private&code_verifier=private&token=private&error=denied&error_code=expired&view=sign%20up",
    );
    expect(value).toBe("/?from=email%20confirmation#view=sign%20up");
  });
  it("preserves ordinary hash anchors exactly when cleaning query credentials", () => {
    expect(
      cleanedAuthCallbackUrl("https://stride.test/?access_token=private#/Home"),
    ).toBe("/#/Home");
    expect(
      cleanedAuthCallbackUrl("https://stride.test/?from=email#/Home"),
    ).toBeNull();
  });
  it("recognizes encoded callback keys and safely leaves malformed unrelated encoding alone", () => {
    expect(
      cleanedAuthCallbackUrl(
        "https://stride.test/?%61ccess_token=private&keep=%2F#%72efresh_token=private&anchor=%ZZ",
      ),
    ).toBe("/?keep=%2F#anchor=%ZZ");
  });
});
