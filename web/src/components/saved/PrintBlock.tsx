// A board as a clean evidence list for printing: hidden on screen, shown by styles/saved.css when printing. Each item
// with its saved label, amount text, years, release and full citation text; private notes only when asked for.
import { SAVED, SITE } from "@/lib/copy";
import { date, releaseShort } from "@/lib/format";
import { citationText } from "@/lib/domain/citation";
import type { Board } from "@/lib/domain/saved";

function text(c: NonNullable<Board["items"][number]["citation"]>): string {
  try {
    return citationText(c);
  } catch {
    return SAVED.noCitationText;
  }
}

export function PrintBlock({ board, notes }: { board: Board; notes: boolean }) {
  return (
    <section className="saved-print" aria-hidden="true" data-testid="saved-print-block">
      <h2>{SAVED.printHeading(board.title)}</h2>
      <p>{SAVED.printedFrom}</p>
      {notes && board.note && <p className="saved-print__note"><strong>{SAVED.printNoteLabel}</strong> {board.note}</p>}
      <ol>
        {board.items.map((i) => (
          <li key={i.key}>
            <h3>{i.label}</h3>
            <p>
              {SAVED.kind[i.kind]}
              {i.kind === "tie" && <> · {SAVED.item.amountLabel}: {i.amount_text}</>}
              {i.years && <> · {SAVED.item.yearsLabel}: {i.years}</>}
              {" · "}{i.release ? SAVED.item.release(releaseShort(i.release)) : SAVED.item.latestAtTime}
              {" · "}{SAVED.item.savedOn(date(i.saved.slice(0, 10)))}
            </p>
            <pre>{i.citation ? text(i.citation) : SAVED.noCitationText}</pre>
            {notes && i.note && <p className="saved-print__note"><strong>{SAVED.printNoteLabel}</strong> {i.note}</p>}
          </li>
        ))}
      </ol>
      <p>{SITE.disclaimer}</p>
    </section>
  );
}
