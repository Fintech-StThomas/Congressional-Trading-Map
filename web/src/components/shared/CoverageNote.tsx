// A compact, always-visible note of the coverage facts that qualify the measure next to it (lib/domain/coverage.ts
// chooses them, lib/copy.ts words them). Plain text in a list: nothing hides behind hover, and it prints. Server or client.
import "@/styles/cite.css";
import { COVERAGE } from "@/lib/copy";
import { Notice } from "./Notice";
import { factsFor, type CoverageFact, type CoverageScope } from "@/lib/domain/coverage";

/** `scopes` picks the facts for this place; renders nothing when none apply. */
export function CoverageNote({ facts, scopes, label = COVERAGE.heading, testId }: { facts: CoverageFact[]; scopes?: CoverageScope[]; label?: string; testId?: string }) {
  const shown = scopes ? factsFor(facts, scopes) : facts;
  if (!shown.length) return null;
  return (
    <Notice tone="info" className="covnote" aria-label={label} data-testid={testId ?? "coverage-note"}>
      <p className="covnote__k">{label}</p>
      <ul>
        {shown.map((f) => <li key={f.id} data-fact={f.id}>{f.text}</li>)}
      </ul>
    </Notice>
  );
}
