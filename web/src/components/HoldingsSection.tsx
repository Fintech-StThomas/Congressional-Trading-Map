// "Disclosed holdings" on the member page: House annual reports only. Server component.
import Link from "next/link";
import { coverageWords, compactUsd, HOLDINGS_YEARS, netWorthText, rowsOf, SENATE_NOTE, type HoldingsFile } from "@/lib/holdings";

type PortRow = { name: string; org: string | null; sector: string | null; rows: number; low: number; high: number | null; share_low: number | null; share_high: number | null; owners: string[] };
type LiabRow = { creditor: string; type: string; owner: string; low: number | null; high: number | null; residence_secured: boolean };

function band(low: number | null, high: number | null): string {
  if (low === null && high === null) return "no value given";
  if (high === null) return `over ${compactUsd(low ?? 0)}`;
  return `${compactUsd(low ?? 0)}–${compactUsd(high)}`;
}
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

/** Range by year as a band chart: a bar from low to high; open tops fade out; missing years are marked. */
function BandChart({ h }: { h: HoldingsFile }) {
  const [y0, y1] = HOLDINGS_YEARS;
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const vals = years.flatMap((y) => {
    const nw = h.years[String(y)]?.net_worth;
    return nw ? [nw.low ?? 0, nw.high ?? nw.high_valued ?? nw.low ?? 0] : [];
  });
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const W = 560, H = 150, pad = { l: 52, r: 8, t: 8, b: 22 };
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) / years.length) * (i + 0.5);
  const yy = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
  const bw = Math.max(6, ((W - pad.l - pad.r) / years.length) * 0.5);
  return (
    <svg className="hold__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Disclosed net worth range by report year">
      <line x1={pad.l} x2={W - pad.r} y1={yy(0)} y2={yy(0)} className="hold__zero" />
      <text x={pad.l - 6} y={yy(hi) + 4} className="hold__axis" textAnchor="end">{compactUsd(hi)}</text>
      <text x={pad.l - 6} y={yy(0) + 4} className="hold__axis" textAnchor="end">$0</text>
      {lo < 0 && <text x={pad.l - 6} y={yy(lo) + 4} className="hold__axis" textAnchor="end">{compactUsd(lo)}</text>}
      {years.map((y, i) => {
        const nw = h.years[String(y)]?.net_worth;
        const label = String(y).slice(2);
        if (!nw) {
          const why = coverageWords(h.coverage.find((c) => c.year === y)?.status ?? "no_annual_report_in_dataset");
          return (
            <g key={y}>
              <title>{`${y}: ${why}`}</title>
              <text x={x(i)} y={yy(0) - 4} className="hold__miss" textAnchor="middle">–</text>
              <text x={x(i)} y={H - 6} className="hold__axis" textAnchor="middle">{label}</text>
            </g>
          );
        }
        const top = nw.high ?? nw.high_valued ?? nw.low ?? 0;
        const bot = nw.low ?? 0;
        const open = nw.high === null;
        return (
          <g key={y}>
            <title>{`${y}: ${netWorthText(nw)}`}</title>
            <rect x={x(i) - bw / 2} y={yy(Math.max(top, bot))} width={bw} height={Math.max(2, Math.abs(yy(bot) - yy(top)))} className={`hold__bar${open ? " is-open" : ""}`} />
            <text x={x(i)} y={H - 6} className="hold__axis" textAnchor="middle">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function HoldingsSection({ h, everHouse, memberId }: { h: HoldingsFile | null; everHouse: boolean; memberId: string }) {
  if (!h) {
    return (
      <section className="section hold" aria-labelledby="hold-h">
        <h2 id="hold-h">Disclosed holdings</h2>
        <p className="section__note" data-testid="holdings-note">{everHouse ? "No House annual report for this member is in the source data." : SENATE_NOTE}</p>
      </section>
    );
  }
  const years = Object.keys(h.years).sort();
  const latest = years[years.length - 1];
  const Y = h.years[latest];
  const port = rowsOf<PortRow>(h.portfolio);
  const liab = rowsOf<LiabRow>(Y.liabilities);
  const missing = h.coverage.filter((c) => c.status !== "used");
  return (
    <section className="section hold" aria-labelledby="hold-h" data-testid="holdings">
      <h2 id="hold-h">Disclosed holdings</h2>
      <p className="section__note">
        From House annual financial disclosure reports, {years[0]}–{latest}. The figure is a <strong>disclosed net worth range</strong>: disclosed asset bands minus disclosed liability bands. It is not the member&rsquo;s net worth.
      </p>
      <p className="hold__figure">
        <span className="hold__k">Disclosed net worth range, {latest}</span>
        <span className="hold__v mono">{netWorthText(Y.net_worth)}</span>
      </p>
      <BandChart h={h} />
      {missing.length > 0 && (
        <p className="hold__small">Missing years: {missing.map((c) => `${c.year} (${coverageWords(c.status)})`).join("; ")}.</p>
      )}
      <p className="hold__small">
        <strong>What the law leaves out:</strong> {h.net_worth_definition.excludes.join("; ")}.
      </p>

      <h3 className="hold__h">Portfolio, {h.portfolio.year}</h3>
      <div className="tablewrap">
        <table className="ties hold__table">
          <thead><tr><th>Company or fund</th><th>Owner as filed</th><th className="num">Value band</th><th className="num">Share (low / high bound)</th></tr></thead>
          <tbody>
            {port.slice(0, 15).map((r) => (
              <tr key={r.name + (r.org ?? "")}>
                <td>{r.org ? <Link href={`/o/${encodeURIComponent(r.org)}`}>{r.name}</Link> : r.name}{r.sector && <span className="sub"> · {r.sector}</span>}</td>
                <td>{r.owners.join(", ")}</td>
                <td className="num mono">{band(r.low, r.high)}</td>
                <td className="num mono">
                  <span className="hold__share" aria-hidden="true"><span style={{ width: `${Math.min(100, (r.share_low ?? 0) * 100)}%` }} /></span>
                  {pct(r.share_low)} / {pct(r.share_high)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {port.length > 15 && <p className="hold__small">{port.length - 15} more holdings are in the <Link href={`/m/${memberId}/records#rec-holdings`}>full file</Link>.</p>}

      <h3 className="hold__h">Liabilities, {latest}</h3>
      {liab.length === 0 ? (
        <p className="hold__small">None disclosed (liabilities of $10,000 or less are not reported).</p>
      ) : (
        <div className="tablewrap">
          <table className="ties hold__table">
            <thead><tr><th>Creditor as filed</th><th>Type</th><th>Owner</th><th className="num">Highest amount owed</th></tr></thead>
            <tbody>
              {liab.map((r, i) => (
                <tr key={i}>
                  <td>{r.creditor}</td>
                  <td>{r.type}{r.residence_secured && <span className="sub"> · residence-secured, not subtracted</span>}</td>
                  <td>{r.owner}</td>
                  <td className="num mono">{band(r.low, r.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
