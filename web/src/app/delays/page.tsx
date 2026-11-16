// /delays: observed days between the transaction date as filed and the date the report became public, site-wide
// and by member. Static in local mode; in remote and pinned modes it reads delays.json through the Data reader.
import type { Metadata } from "next";
import { DELAYS } from "@/lib/copy";
import { DelaysView } from "@/components/delays/DelaysView";

export const metadata: Metadata = {
  title: DELAYS.title,
  description: DELAYS.description,
};

export default function DelaysPage() {
  return <DelaysView />;
}
