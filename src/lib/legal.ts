import terms from "../../docs/TERMS_OF_SERVICE.md?raw";
import privacy from "../../docs/DATA_AND_PRIVACY.md?raw";

export type LegalDocumentId = "terms" | "privacy";

function documentVersion(source: string, label: string): string {
  const version = source.match(
    new RegExp(`^${label} Version: (\\d{4}-\\d{2}-\\d{2})\\s*$`, "m"),
  )?.[1];
  if (!version) throw new Error("The legal document version is missing.");
  return version;
}

// These are the same repository documents included in the app bundle, so a
// cached web shell or installed Windows build can read them without a request.
export const legalDocuments = {
  terms: {
    title: "Terms of Service",
    version: documentVersion(terms, "Terms"),
    source: terms,
  },
  privacy: {
    title: "Data & Privacy Notice",
    version: documentVersion(privacy, "Privacy"),
    source: privacy,
  },
} as const;

export interface SignupConsent {
  accepted: boolean;
  termsVersion: string;
  privacyVersion: string;
}

export const consentRequiredMessage =
  "Agree to the Terms of Service and acknowledge the Data & Privacy Notice before creating your account.";

export function currentSignupConsent(accepted: boolean): SignupConsent {
  return {
    accepted,
    termsVersion: legalDocuments.terms.version,
    privacyVersion: legalDocuments.privacy.version,
  };
}

// This is an app-side signup gate, not a durable server acceptance receipt.
// It deliberately does not persist state or add Supabase Auth metadata.
export function hasCurrentSignupConsent(
  value: unknown,
): value is SignupConsent {
  if (!value || typeof value !== "object") return false;
  const consent = value as Partial<SignupConsent>;
  return (
    consent.accepted === true &&
    consent.termsVersion === legalDocuments.terms.version &&
    consent.privacyVersion === legalDocuments.privacy.version
  );
}
