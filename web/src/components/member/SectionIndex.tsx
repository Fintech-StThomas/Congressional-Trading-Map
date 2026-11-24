// A small in-page index near the top of a long page: plain anchor links to its sections (Cases · Ties · Activity ·
// Campaign money · Holdings · Trades). Sticky, script-free section shortcuts. Screen only. Wording is in lib/copy-ui.ts.
import { SECTION_INDEX } from "@/lib/copy-ui";

/** The member page's sections, in page order (Cases only when the member has any). */
export function memberSections(hasCases: boolean): { id: string; label: string }[] {
  const ids = [...(hasCases ? (["cases"] as const) : []), "ties", "activity", "money", "holdings", "trades"] as const;
  return ids.map((id) => ({ id, label: SECTION_INDEX[id] }));
}

export function SectionIndex({ links }: { links: { id: string; label: string }[] }) {
  return (
    <>
      <span id="section-index-start" className="secindex-start" tabIndex={-1} />
      <nav className="secindex no-print" aria-label={SECTION_INDEX.aria} data-testid="section-index">
        <span className="secindex__k" aria-hidden="true">{SECTION_INDEX.label}</span>
        <ul>
          {links.map((l) => (
            <li key={l.id}>
              <a href={`#${l.id}`}>{l.label}</a>
            </li>
          ))}
          <li><a href="#section-index-start">{SECTION_INDEX.backToSections}</a></li>
        </ul>
      </nav>
    </>
  );
}
