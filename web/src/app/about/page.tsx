// /about: who builds Paper Trail, how it is paid for, the licence, and what it keeps about visitors.
import type { Metadata } from "next";
import Link from "next/link";
import { ABOUT, SITE } from "@/lib/copy";
import { CorrectionLink } from "@/components/shared/CorrectionLink";

export const metadata: Metadata = {
  title: "About",
  description: "Who builds Paper Trail, how it is paid for, the licence, and what the site keeps about visitors.",
};

export default function AboutPage() {
  return (
    <div className="page page--read">
      <h1>About {SITE.name}</h1>
      <p>{SITE.description}</p>
      <p>{SITE.disclaimer}</p>

      <section className="section" aria-labelledby="team-h">
        <h2 id="team-h">Who builds it</h2>
        <p>{ABOUT.origin}</p>
        <ul>
          {ABOUT.team.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="funding-h">
        <h2 id="funding-h">Funding and independence</h2>
        <p>{ABOUT.funding}</p>
        <p>{ABOUT.independence}</p>
      </section>

      <section className="section" aria-labelledby="open-h">
        <h2 id="open-h">Open source</h2>
        <p>{ABOUT.openSource}</p>
        <p>
          <a href={ABOUT.repoUrl} rel="noopener noreferrer">
            Read the code on GitHub
          </a>
          {" · "}
          <Link href="/method">Sources and method</Link>
        </p>
      </section>

      <section className="section" aria-labelledby="visitors-h">
        <h2 id="visitors-h">What the site keeps about you</h2>
        <p>{ABOUT.visitors}</p>
      </section>

      <section className="section" aria-labelledby="wrong-h">
        <h2 id="wrong-h">Found something wrong?</h2>
        <p>
          Reports are public and every one is read. Members of Congress and their offices can use the same route to reply.
        </p>
        <p>
          <CorrectionLink />
        </p>
      </section>
    </div>
  );
}
