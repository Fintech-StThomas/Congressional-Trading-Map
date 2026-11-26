// /flags ("Review flags"): trades meeting two or more published rules, or any rule and made public in the last 30
// days. Static in local mode; in remote and pinned modes it reads flags.json through the Data reader, as /delays does.
import type { Metadata } from "next";
import { FLAGS } from "@/lib/copy-flags";
import { latestData } from "@/lib/data/server";
import { readFlags } from "@/lib/domain/flags";
import { FlagsView } from "@/components/flags/FlagsView";

export const metadata: Metadata = {
  title: FLAGS.title,
  description: FLAGS.description,
  alternates: { types: { "application/rss+xml": "/feed/flags.xml" } },
};

export default async function FlagsPage() {
  const data = await latestData();
  return <FlagsView data={data} flags={readFlags(await data.readData<unknown>("flags.json", null))} />;
}
