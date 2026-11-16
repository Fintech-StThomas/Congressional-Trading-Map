// /embed: how to put a member card on another page: the copyable <iframe>, the attribution requirement and the
// 13107(c) notice. The cards themselves are the route handlers under app/embed/m and app/embed/r.
import type { Metadata } from "next";
import { EMBED, SITE, USE_NOTICE } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { EmbedBuilder } from "@/components/embed/EmbedBuilder";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export const metadata: Metadata = {
  title: EMBED.title,
  description: EMBED.intro,
};

export default async function EmbedHelpPage() {
  const data = await latestData();
  return (
    <div className="page page--read">
      <ReleasePin release={data.release} />
      <h1>{EMBED.title}</h1>
      <p className="lede">{EMBED.intro}</p>
      <p>{EMBED.attribution}</p>
      <p>{EMBED.usage}</p>
      <p>{EMBED.pinned}</p>
      <ErrorBoundary label="embed builder">
        <EmbedBuilder release={data.release} />
      </ErrorBoundary>
      <section className="section" aria-labelledby="embed-notice">
        <h2 id="embed-notice">{EMBED.noticeHeading}</h2>
        <p>{USE_NOTICE}</p>
        <p>{SITE.disclaimer}</p>
      </section>
    </div>
  );
}
