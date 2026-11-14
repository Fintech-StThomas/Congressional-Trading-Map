import type { Metadata } from "next";
import { readData } from "@/lib/data";
import { decodeOrgIndex } from "@/lib/party";
import { OrgsBrowse } from "@/components/OrgsBrowse";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { YEAR_MIN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Organisations",
  description: "The organisations tied by money to the most current members of Congress, and those that gave the most, split by party.",
};

type Raw = Parameters<typeof decodeOrgIndex>[0];

export default function OrgsPage() {
  const data = decodeOrgIndex(readData<Raw>("org-index.json", null));
  const empty = data.byMembers.length === 0 && data.byDollars.length === 0;
  return (
    <div className="page page--narrow orgspage">
      <h1>Organisations</h1>
      <p className="lede">
        {empty
          ? "The organisation index is not in this build."
          : `The organisations whose PAC money or outside spending reaches the most current members, and those whose PACs gave current members the most since ${YEAR_MIN}. Former members are left out of these rankings.`}
      </p>
      {!empty && (
        <ErrorBoundary label="organisation lists">
          <OrgsBrowse data={data} />
        </ErrorBoundary>
      )}
    </div>
  );
}
