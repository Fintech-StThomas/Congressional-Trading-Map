"use client";
// The citation for the page view in print: a plain text block, hidden on screen (styles/cite.css). Built in the
// browser when the page mounts and again just before printing, so the retrieval date is the day it was printed.
import "@/styles/cite.css";
import { useEffect, useState } from "react";
import { CITE } from "@/lib/copy";
import { citationText, type Citation } from "@/lib/domain/citation";

/** `casefile`: also carries the case-file class, which the member page's print rules keep visible. */
export function CitePrint({ build, casefile }: { build: (retrieved: string) => Citation; casefile?: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const make = () => setText(citationText(build(new Date().toISOString())));
    make();
    window.addEventListener("beforeprint", make);
    return () => window.removeEventListener("beforeprint", make);
  }, [build]);
  if (!text) return null;
  return (
    <section className={`cite-print${casefile ? " casefile" : ""}`} aria-hidden="true" data-testid="cite-print">
      <h2>{CITE.printHeading}</h2>
      <pre>{text}</pre>
    </section>
  );
}
