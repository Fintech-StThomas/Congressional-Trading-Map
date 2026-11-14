// /cases: page 1 of every Case (a member and an organisation tied by several kinds of filed record in the
// same years), ranked as cases.json orders them. Further pages and filters: app/cases/[...slug].
import type { Metadata } from "next";
import { CasesView } from "@/components/cases/CasesView";

export const metadata: Metadata = {
  title: "Open cases",
  description: "Members of Congress and organisations tied by two or more kinds of filed record in the same years, ranked.",
};

export default function CasesPage() {
  return <CasesView q={{ page: 1 }} />;
}
