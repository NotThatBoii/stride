import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { legalDocuments, type LegalDocumentId } from "../lib/legal";

export function LegalLink({
  documentId,
  onOpen,
}: {
  documentId: LegalDocumentId;
  onOpen(documentId: LegalDocumentId, opener: HTMLElement): void;
}) {
  return (
    <a
      href={`#legal-${documentId}`}
      onClick={(event) => {
        event.preventDefault();
        onOpen(documentId, event.currentTarget);
      }}
    >
      {legalDocuments[documentId].title}
    </a>
  );
}

export function LegalLinks({
  onOpen,
}: {
  onOpen(documentId: LegalDocumentId, opener: HTMLElement): void;
}) {
  return (
    <nav className="legal-links" aria-label="Legal documents">
      <LegalLink documentId="terms" onOpen={onOpen} />
      <LegalLink documentId="privacy" onOpen={onOpen} />
    </nav>
  );
}

function inlineText(source: string): ReactNode[] {
  const output: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let start = 0;
  for (const match of source.matchAll(pattern)) {
    output.push(source.slice(start, match.index));
    if (match[1]) {
      let safeUrl: string | null = null;
      try {
        const url = new URL(match[2]);
        if (url.protocol === "https:" && !url.username && !url.password)
          safeUrl = url.href;
      } catch {
        // Unknown/relative Markdown links stay readable text. No document
        // markup can request an arbitrary protocol or filesystem operation.
      }
      output.push(
        safeUrl ? (
          <a
            key={match.index}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {match[1]}
          </a>
        ) : (
          match[1]
        ),
      );
    } else if (match[3]) {
      output.push(<strong key={match.index}>{match[3]}</strong>);
    } else {
      output.push(<code key={match.index}>{match[4]}</code>);
    }
    start = match.index! + match[0].length;
  }
  output.push(source.slice(start));
  return output;
}

function cells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

// These static repository sources use headings, paragraphs, lists and a
// storage table. Render those as React text; never interpret HTML or scripts.
function LegalText({ source }: { source: string }) {
  return source
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block, index) => {
      const lines = block.split(/\r?\n/);
      if (/^# /.test(block)) return null; // The dialog already names the document.
      if (/^## /.test(block))
        return <h3 key={index}>{inlineText(block.slice(3))}</h3>;
      if (lines.every((line) => /^- /.test(line)))
        return (
          <ul key={index}>
            {lines.map((line, item) => (
              <li key={item}>{inlineText(line.slice(2))}</li>
            ))}
          </ul>
        );
      if (lines.length > 2 && lines.every((line) => /^\|.*\|$/.test(line)))
        return (
          <div
            className="legal-table-scroll"
            key={index}
            tabIndex={0}
            aria-label="Study data storage table"
          >
            <table>
              <thead>
                <tr>
                  {cells(lines[0]).map((cell, column) => (
                    <th key={column} scope="col">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.slice(2).map((line, row) => (
                  <tr key={row}>
                    {cells(line).map((cell, column) => (
                      <td key={column}>{inlineText(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      return <p key={index}>{inlineText(lines.join(" "))}</p>;
    });
}

export function LegalDialog({
  documentId,
  returnFocusTo,
  onClose,
}: {
  documentId: LegalDocumentId;
  returnFocusTo: HTMLElement;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const document = legalDocuments[documentId];
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (returnFocusTo.isConnected) returnFocusTo.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialog}
      className="legal-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, a[href], [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        if (
          event.shiftKey &&
          globalThis.document.activeElement === controls[0]
        ) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          globalThis.document.activeElement === controls.at(-1)
        ) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }}
    >
      <div className="dialog-heading">
        <h2 id={headingId}>{document.title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close legal document"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <article className="legal-document" data-version={document.version}>
        <LegalText source={document.source} />
      </article>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
