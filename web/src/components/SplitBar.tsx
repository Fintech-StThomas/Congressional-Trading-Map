import "@/app/reach.css";
import { PARTY_FULL, PARTY_ORDER, type Parts } from "@/lib/party";

type Props = {
  /** Values that set the segment lengths. */
  values: Parts;
  /** Printed beside each party letter in the key, e.g. "198 · $3.7M". Omit for the inline variant. */
  labels?: Partial<Record<keyof Parts, string>>;
  /** Accessible description of the whole bar. */
  label: string;
  inline?: boolean;
};

/**
 * A party split as one horizontal bar: D, I, R segments in a fixed order,
 * told apart by a letter and a neutral pattern (solid, dotted, hatched), never by colour.
 */
export function SplitBar({ values, labels, label, inline }: Props) {
  const sum = PARTY_ORDER.reduce((n, p) => n + Math.max(0, values[p]), 0);
  return (
    <div className={`split${inline ? " split--inline" : ""}`}>
      <div className="split__bar" role="img" aria-label={label}>
        {sum === 0 ? (
          <span className="split__none" />
        ) : (
          PARTY_ORDER.filter((p) => values[p] > 0).map((p) => {
            const share = values[p] / sum;
            return (
              <span key={p} className={`seg seg--${p}`} style={{ flexGrow: values[p], flexBasis: 0 }}>
                {!inline && share >= 0.05 && <b aria-hidden="true">{p}</b>}
              </span>
            );
          })
        )}
      </div>
      {labels && (
        <ul className="split__key" aria-hidden="true">
          {PARTY_ORDER.map((p) => (
            <li key={p} className={values[p] > 0 ? undefined : "is-zero"} title={PARTY_FULL[p]}>
              <span className={`swatch seg--${p}`} />
              <b>{p}</b>
              <span className="mono">{labels[p] ?? "0"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
