"use client";
// Shown on the board when the URL selects a tie the board does not draw (it draws only the largest ties): says so and
// links to the case file, which lists every tie, carrying the same view.
import { VIEW } from "@/lib/copy";
import { memberHref } from "@/lib/urls";
import { ViewLink } from "@/components/shared/ViewLink";

export function TieMissing({ member }: { member: string }) {
  return (
    <p className="view-selected no-print" role="status" data-testid="board-tie-missing">
      {VIEW.notDrawn} <ViewLink href={memberHref(member)}>{VIEW.notDrawnLink}</ViewLink>
    </p>
  );
}
