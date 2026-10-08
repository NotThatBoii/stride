import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { supabase } from "../lib/supabase";
import {
  LegalReceiptController,
  createReceiptGateway,
  currentLegalPair,
  receiptConsentMessage,
} from "../lib/legal-receipt";
import { LegalDialog, LegalLink, LegalLinks } from "./LegalDocuments";
import type { LegalDocumentId } from "../lib/legal";

const gateway = createReceiptGateway(supabase);
export function LegalAcceptancePanel({
  accountId,
  confirmed,
}: {
  accountId: string;
  confirmed: boolean;
}) {
  const pair = currentLegalPair();
  const controller = useMemo(
    () => new LegalReceiptController(gateway, accountId, pair, confirmed),
    [accountId, pair.termsVersion, pair.privacyVersion, confirmed],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [accepted, setAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState<{
    id: LegalDocumentId;
    opener: HTMLElement;
  } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingId = useId();
  const consentId = useId();
  const errorId = useId();
  useEffect(() => {
    setAccepted(false);
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    if (snapshot.focus === "receipt") {
      setAccepted(false);
      receiptRef.current?.focus();
    }
    if (snapshot.focus === "error") {
      setAccepted(false);
      errorRef.current?.focus();
    }
  }, [snapshot.focus, snapshot.error]);
  const openLegal = (id: LegalDocumentId, opener: HTMLElement) =>
    setLegalDocument({ id, opener });
  const pending =
    snapshot.phase === "loading" || snapshot.phase === "recording";
  return (
    <section
      ref={sectionRef}
      className="legal-acceptance"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <h3 id={headingId}>Optional acknowledgement receipt</h3>
      <p>
        Your study workspace does not require this receipt. You can choose to
        record a new acknowledgement after confirming your email. Its time is
        set by the server when recorded; it is not your original signup time.
      </p>
      <p className="hint">
        Terms version {pair.termsVersion}; Privacy version {pair.privacyVersion}
        .
      </p>
      {snapshot.phase === "unconfirmed" && (
        <p role="status">
          Confirm your email, then sign in again to record an acknowledgement.
          You can keep using your available study workspace.
        </p>
      )}
      {(snapshot.phase === "idle" || snapshot.phase === "loading") && (
        <p role="status">Checking your receipt…</p>
      )}
      {snapshot.phase === "recording" && (
        <p role="status">Recording your acknowledgement…</p>
      )}
      {snapshot.receipt && (
        <p
          ref={receiptRef}
          tabIndex={-1}
          role="status"
          className="receipt-status"
        >
          Acknowledgement recorded by the server on{" "}
          <time
            dateTime={snapshot.receipt.accepted_at}
            title={snapshot.receipt.accepted_at}
          >
            {new Date(snapshot.receipt.accepted_at).toLocaleString()}
          </time>{" "}
          for Terms {snapshot.receipt.terms_version} and Privacy{" "}
          {snapshot.receipt.privacy_version}.
        </p>
      )}
      {snapshot.phase === "none" && (
        <>
          <p role="status">
            No receipt is recorded for these document versions.
          </p>
          <label className="receipt-consent" htmlFor={consentId}>
            <input
              id={consentId}
              type="checkbox"
              checked={accepted}
              aria-invalid={
                snapshot.error === receiptConsentMessage || undefined
              }
              aria-describedby={snapshot.error ? errorId : undefined}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              I agree to the <LegalLink documentId="terms" onOpen={openLegal} />{" "}
              (version {pair.termsVersion}) and acknowledge the{" "}
              <LegalLink documentId="privacy" onOpen={openLegal} /> (version{" "}
              {pair.privacyVersion}).
            </span>
          </label>
          <p className="hint">
            Tick the optional checkbox to enable recording. Reading a document
            does not record your agreement.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={!accepted}
            onClick={() => void controller.record({ accepted, ...pair })}
          >
            Record acknowledgement
          </button>
        </>
      )}
      {snapshot.error && (
        <p
          id={errorId}
          ref={errorRef}
          tabIndex={-1}
          role={snapshot.focus === "error" ? "alert" : "status"}
          className="error"
        >
          {snapshot.error}
        </p>
      )}
      {(snapshot.phase === "error" || snapshot.phase === "recorded") && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setAccepted(false);
            void controller.load();
          }}
        >
          Check receipt status
        </button>
      )}
      {snapshot.phase !== "none" && <LegalLinks onOpen={openLegal} />}
      {legalDocument && (
        <LegalDialog
          documentId={legalDocument.id}
          returnFocusTo={legalDocument.opener}
          onClose={() => {
            const previous = legalDocument;
            setLegalDocument(null);
            if (!previous.opener.isConnected)
              requestAnimationFrame(() =>
                sectionRef.current
                  ?.querySelector<HTMLElement>(
                    `a[href="#legal-${previous.id}"]`,
                  )
                  ?.focus(),
              );
          }}
        />
      )}
    </section>
  );
}
