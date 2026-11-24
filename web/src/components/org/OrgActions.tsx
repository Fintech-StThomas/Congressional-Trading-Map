"use client";
// "Cite this" and the CSV of the ties table on an organisation page. The citation records the member search and row
// count in view; its permanent link exists only when the page was served from an archived release. The release and
// build time come from the page's pin (a latest page rendered from release R names R's permanent page).
import { useState } from "react";
import { CiteButton } from "@/components/shared/CiteButton";
import { useCiteEnv } from "@/components/shared/CiteEnv";
import { download } from "@/components/shared/download";
import { buildOrgCitation } from "@/lib/domain/citation-page";
import { orgTiesCsv, type OrgCsvRow } from "@/lib/domain/orgcsv";
import { PERMALINK } from "@/lib/copy-permalink";

export type OrgActionsProps = {
  org: { id: string; name: string };
  /** The rows in view (filtered and sorted), with who each member is. */
  rows: OrgCsvRow[];
  listed: number;
  total: number;
  members: number;
  query: string;
  sources: Record<string, string>;
};

export function OrgActions({ org, rows, listed, total, members, query, sources }: OrgActionsProps) {
  const [active, setActive] = useState(false);
  const env = useCiteEnv(active, sources);
  const filtered = rows.length !== listed;
  return (
    <>
      <CiteButton
        testId="cite-org"
        onOpenChange={setActive}
        build={(retrieved) => buildOrgCitation({
          org, env: { ...env, retrieved }, dates: { first: null, last: null },
          counts: { members_tied: members, ties_listed: listed, ties_total: total },
          view: { query, shown: rows.length, total: listed },
        })}
      />
      <button
        type="button"
        className="btn btn--small"
        data-testid="org-csv"
        onClick={() => download(`${PERMALINK.org.csvFile}-${org.id.replace(/[^A-Za-z0-9._-]+/g, "-")}.csv`, orgTiesCsv(rows, PERMALINK.org.csvNote), "text/csv;charset=utf-8")}
      >
        {filtered ? PERMALINK.org.csvButtonFiltered : PERMALINK.org.csvButton}
      </button>
    </>
  );
}
