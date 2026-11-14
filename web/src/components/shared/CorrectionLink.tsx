"use client";
// "Report a correction": a link to a new public GitHub issue, prefilled with the page the reader is on,
// the data build time and, where given, the record (edge type, both ends, record ids).
// The layout provides the build time once (CorrectionProvider); the full address, query string
// included, is read from the browser at click time so the link stays static in the HTML.
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CORRECTIONS, SITE } from "@/lib/copy";
import { correctionIssueUrl } from "@/lib/urls";

const BuiltCtx = createContext<string | null>(null);

export function CorrectionProvider({ built, children }: { built: string | null; children: ReactNode }) {
  return <BuiltCtx.Provider value={built}>{children}</BuiltCtx.Provider>;
}

type Props = {
  /** Issue title after "Correction: ", e.g. a member's name or a tie. Defaults to the page address. */
  what?: string;
  /** Extra lines for the issue body (record ids and the like). */
  details?: string[];
  /** Link text; defaults to "Report a correction". */
  children?: ReactNode;
  className?: string;
};

export function CorrectionLink({ what, details, children, className }: Props) {
  const built = useContext(BuiltCtx);
  const path = usePathname() ?? "/";
  const href = (page: string) => correctionIssueUrl({ page, built, what, details });
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // The full address the reader was on (with ?s=… or ?page=…), filled in as they follow the link.
    e.currentTarget.href = href(window.location.href);
  };
  return (
    <a className={className} href={href(`${SITE.url}${path}`)} onClick={onClick} onAuxClick={onClick} target="_blank" rel="noopener noreferrer" title={CORRECTIONS.note} data-testid="correction-link">
      {children ?? CORRECTIONS.link}
    </a>
  );
}
