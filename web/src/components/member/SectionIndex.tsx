// A small in-page index near the top of a long page: plain anchor links to its sections (Cases · Ties · Activity ·
// Holdings · Trades). Not sticky, no script. Screen only. Wording is in lib/copy-ui.ts (SECTION_INDEX).
import { SECTION_INDEX } from "@/lib/copy-ui";

export function SectionIndex({ links }: { links: { id: string; label: string }[] }) {
  return (
    <nav className="secindex no-print" aria-label={SECTION_INDEX.aria} data-testid="section-index">
      <span className="secindex__k" aria-hidden="true">{SECTION_INDEX.label}</span>
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <a href={`#${l.id}`}>{l.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
