// /orgs: organisation rankings, built from org-index.json.
import type { Metadata } from "next";
import { latestData } from "@/lib/data/server";
import { decodeOrgIndex } from "@/lib/domain/party";
import { OrgsBrowse } from "@/components/org/OrgsBrowse";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { YEAR_MIN } from "@/lib/years";

export const metadata: Metadata = {
  title: "Organisations",
  description: "The organisations tied by money to the most current members of Congress, and those that gave the most, split by party.",
};

type Raw = Parameters<typeof decodeOrgIndex>[0];

export default async function OrgsPage() {
  const release = await latestData();
  const data = decodeOrgIndex(await release.readData<Raw>("org-index.json", null));
  const empty = data.byMembers.length === 0 && data.byDollars.length === 0;
  return (
    <div className="page page--narrow orgspage">
      <ReleasePin release={release.release} />
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
