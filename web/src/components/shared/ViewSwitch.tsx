"use client";
// "View: Board · Case file · Full file": the three views of one member, each link carrying the current view state
// (years, assumptions, tie families, selected tie, date basis) so moving between them keeps the investigation.
import Link from "next/link";
import "@/styles/view.css";
import { VIEW } from "@/lib/copy";
import { withView } from "@/lib/domain/viewstate";
import { boardHref, memberHref, recordsHref, releaseMemberHref, releaseRecordsHref } from "@/lib/urls";
import { useView } from "./useViewState";

export type ViewName = "board" | "case" | "full";

/**
 * `state` is the member's state code for the board link (current members only). `release` points the case file and
 * full-file links at that archived release; the board has no permalink and always shows the latest data.
 */
export function ViewSwitch({ current, member, state, release = null, testId = "view-switch" }: { current: ViewName; member: string; state?: string | null; release?: string | null; testId?: string }) {
  const view = useView();
  const links: { name: ViewName; label: string; href: string }[] = [
    { name: "board", label: VIEW.board, href: boardHref({ s: state ?? undefined, m: member }) },
    { name: "case", label: VIEW.caseFile, href: release ? releaseMemberHref(release, member) : memberHref(member) },
    { name: "full", label: VIEW.fullFile, href: release ? releaseRecordsHref(release, member) : recordsHref(member) },
  ];
  return (
    <nav className="viewswitch no-print" aria-label={VIEW.switchAria} data-testid={testId}>
      <span className="viewswitch__k" aria-hidden="true">{VIEW.switchLabel}</span>
      <ul>
        {links.map((l) => (
          <li key={l.name}>
            <Link href={withView(l.href, view)} aria-current={l.name === current ? "page" : undefined} data-view={l.name}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
