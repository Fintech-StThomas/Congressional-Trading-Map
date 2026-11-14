// The compact member shape shipped to the browser, the name book that labels board nodes,
// and the organisation kind labels. Pure (types only).
import type { MemberSummary, NodeRef, OrgSummary } from "../types.ts";

/** The compact member shape the board and search ship to the browser. */
export type BoardMember = {
  id: string;
  name: string;
  last: string;
  party: MemberSummary["party"];
  state: string;
  chamber: MemberSummary["chamber"];
  district: number | null;
  photo: boolean;
  current: boolean;
  cases: number;
};

export function toBoardMember(m: MemberSummary): BoardMember {
  return {
    id: m.id, name: m.name, last: m.last, party: m.party, state: m.state, chamber: m.chamber,
    district: m.district, photo: m.photo, current: m.current, cases: m.counts?.cases ?? 0,
  };
}

/** Names for every node a view can show, keyed by id. */
export type NameBook = {
  members: Record<string, BoardMember>;
  orgs: Record<string, OrgSummary>;
};

export function nodeName(ref: NodeRef, book: NameBook): string {
  if (ref.kind === "member") return book.members[ref.id]?.name ?? ref.id;
  return book.orgs[ref.id]?.name ?? ref.id;
}

export const ORG_KIND_LABEL: Record<OrgSummary["kind"], string> = {
  company: "Company",
  pac: "PAC",
  party: "Party committee",
  super_pac: "Super PAC",
  committee: "Congressional committee",
  lobby: "Lobbying",
  other: "Other",
};
