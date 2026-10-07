import { describe, expect, it } from "vitest";
import {
  currentSignupConsent,
  hasCurrentSignupConsent,
  legalDocuments,
} from "./legal";

describe("bundled legal documents", () => {
  it("takes signup versions from the same readable bundled documents", () => {
    expect(legalDocuments.terms.source).toContain(
      `Terms Version: ${legalDocuments.terms.version}`,
    );
    expect(legalDocuments.privacy.source).toContain(
      `Privacy Version: ${legalDocuments.privacy.version}`,
    );
    expect(legalDocuments.terms.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(legalDocuments.privacy.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hasCurrentSignupConsent(currentSignupConsent(true))).toBe(true);
    expect(hasCurrentSignupConsent(currentSignupConsent(false))).toBe(false);
  });
});
