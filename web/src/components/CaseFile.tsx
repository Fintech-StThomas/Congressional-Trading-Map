// The printable case file: a print-first document rendered with the member page
// and shown only in print (window.print). Server component; no client code.
import type { Edge, MemberFileWire, MetaSource } from "@/lib/types";
import type { LedgerRow, TradeRow } from "@/lib/decode";
import { typeLabel, amountLabel } from "@/lib/edges";
import { count, date, money, PARTY_NAMES, seat, served, yearSpan } from "@/lib/format";
import { CASE_NOT_SHOWN, notShown } from "@/lib/notshown";
import { SITE } from "@/lib/site";
import { USE_NOTICE } from "@/lib/records";

/** PT-<bioguide>-<data build date as YYYYMMDD>: deterministic for a member and a build. */
export function caseNumber(id: string, built: string | null): string {
  const d = (built ?? "").slice(0, 10).replace(/-/g, "");
  return `PT-${id}-${/^\d{8}$/.test(d) ? d : "00000000"}`;
}

const TOP_LEDGER = 25;
const TOP_TRADES = 25;

function rowAmount(r: { exact: number | null; low: number | null; high: number | null }): string {
  if (r.exact !== null) return money(r.exact);
  if (r.low !== null && r.high !== null) return `${money(r.low)}–${money(r.high)}`;
  if (r.low !== null) return `over ${money(r.low)}`;
  return "not disclosed";
}

export function CaseFile({ file, board, names, ledger, trades, sources, built, orgName }: {
  file: MemberFileWire; board: Edge[]; names: (id: string) => string; ledger: LedgerRow[]; trades: TradeRow[];
  sources: MetaSource[]; built: string | null; orgName: (id: string) => string;
}) {
  const m = file.member;
  const no = caseNumber(m.id, built);
  const ts = file.trade_summary;
  const nTrades = ts?.count ?? 0;
  const fullUrl = `${SITE.url}/m/${m.id}/records`;
  const liveUrl = `${SITE.url}/m/${m.id}`;
  const topLedger = [...ledger].filter((r) => r.type !== "sits_with")
    .sort((a, b) => (b.exact ?? b.high ?? b.low ?? 0) - (a.exact ?? a.high ?? a.low ?? 0)).slice(0, TOP_LEDGER);
  const ledgerTotal = Object.values(file.ledger_totals ?? {}).reduce((n, t) => n + (t?.edges ?? 0), 0);
  const years = Object.entries(ts?.by_year ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const other = (e: Edge) => (e.from.id === m.id ? e.to : e.from);

  return (
    <div className="casefile" aria-hidden="true">
      <section className="cf__cover">
        <p className="cf__site">{SITE.name}</p>
        <p className="cf__stamp">CASE FILE</p>
        <p className="cf__no mono">{no}</p>
        <div className="cf__who">
          {m.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- print: eager, greyscale, fixed size
            <img className="cf__photo" src={`/portraits/${m.id}.webp`} alt="" width={150} height={183} loading="eager" />
          ) : (
            <span className="cf__photo cf__photo--blank">{m.first[0]}{m.last[0]}</span>
          )}
          <div>
            <h2 className="cf__name">{m.name}</h2>
            <p>{seat(m)}</p>
            <p>{PARTY_NAMES[m.party]} · {m.current ? "Serving" : "Former member"} · served {served(m.served)}</p>
            <p className="mono">Bioguide {m.id}{m.fec_ids.length ? ` · FEC ${m.fec_ids.join(", ")}` : ""}</p>
          </div>
        </div>
        <p className="cf__asof">Records as of {built ? date(built) : "an unknown date"}. Live file: {liveUrl}</p>
        <p className="cf__disc">{SITE.disclaimer} Every entry below is a filed public record or a published statistical rule; none is a finding of wrongdoing.</p>
      </section>

      <section className="cf__sec">
        <h3>Summary</h3>
        <table className="cf__counts">
          <tbody>
            <tr><th>Household trades reported</th><td>{count(nTrades)}</td><th>Disclosed late (over 45 days)</th><td>{count(ts?.late ?? 0)}</td></tr>
            <tr><th>Organisations tied</th><td>{count(m.counts.orgs)}</td><th>Members tied</th><td>{count(m.counts.members)}</td></tr>
            <tr><th>Cases</th><td>{count(m.counts.cases)}</td><th>Ties with records attached</th><td>{count(file.edges.length)}</td></tr>
          </tbody>
        </table>
      </section>

      {file.cases.length > 0 && (
        <section className="cf__sec">
          <h3>Cases</h3>
          <p className="cf__note">A company whose stock the household traded while the member received money from its PAC, in the same years. A reason to read the filings, not a finding.</p>
          <table className="cf__table">
            <thead><tr><th>Company</th><th>Years</th><th className="num">Trades</th><th className="num">PAC money, all years</th></tr></thead>
            <tbody>
              {file.cases.map((c) => (
                <tr key={c.id}>
                  <td>{orgName(c.org)}</td><td className="mono">{c.years[0] === c.years[1] ? c.years[0] : `${c.years[0]}–${c.years[1]}`}</td>
                  <td className="num mono">{count(c.trades)}</td><td className="num mono">{c.money ? money(Math.round(c.money)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cf__notshown">What a case does not show: {CASE_NOT_SHOWN}</p>
        </section>
      )}

      <section className="cf__sec">
        <h3>Ties on the board</h3>
        <p className="cf__note">The {board.length} strings the board draws for this member, with amounts and record counts. All {count(file.edges.length)} ties with records attached, and every further tie, are in the full file: {fullUrl}</p>
        <table className="cf__table">
          <thead><tr><th>Tie</th><th>With</th><th className="num">Amount</th><th className="num">Records</th><th>Years</th><th>Does not show</th></tr></thead>
          <tbody>
            {board.map((e) => (
              <tr key={e.id}>
                <td>{typeLabel(e)}{e.basis === "derived" ? " (statistical)" : e.weak ? " (thin evidence)" : ""}</td>
                <td>{names(other(e).id)}</td>
                <td className="num mono">{amountLabel(e) ?? "—"}</td>
                <td className="num mono">{count(e.count)}</td>
                <td className="mono">{yearSpan(e.first, e.last)}</td>
                <td className="cf__small">{notShown(e.type)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {topLedger.length > 0 && (
        <section className="cf__sec">
          <h3>Further money ties, largest first</h3>
          <p className="cf__note">
            The {topLedger.length} largest summarised money ties (no records attached).{" "}
            {ledgerTotal > topLedger.length ? `${count(ledgerTotal - topLedger.length)} more exist; all are in the full file: ${fullUrl}` : ""}
          </p>
          <table className="cf__table">
            <thead><tr><th>Type</th><th>With</th><th className="num">Amount</th><th className="num">Records</th><th>Years</th></tr></thead>
            <tbody>
              {topLedger.map((r, i) => (
                <tr key={i}>
                  <td>{typeLabel({ type: r.type, note: r.note, via: r.via })}</td><td>{names(r.other)}</td>
                  <td className="num mono">{rowAmount(r)}</td><td className="num mono">{count(r.count)}</td><td className="mono">{yearSpan(r.first, r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {nTrades > 0 && (
        <section className="cf__sec">
          <h3>Household trades</h3>
          <p className="cf__note">{count(nTrades)} periodic transaction reports as filed (current versions). Amounts are disclosed ranges. The {Math.min(TOP_TRADES, trades.length)} most recent are listed; all {count(nTrades)} are in the full file: {fullUrl}</p>
          <div className="cf__three">
            <table className="cf__table cf__mini">
              <thead><tr><th>Year</th><th className="num">Trades</th></tr></thead>
              <tbody>{years.map(([y, n]) => <tr key={y}><td>{y === "none" ? "no date" : y}</td><td className="num mono">{count(n)}</td></tr>)}</tbody>
            </table>
            <table className="cf__table cf__mini">
              <thead><tr><th>Owner as filed</th><th className="num">Trades</th></tr></thead>
              <tbody>{Object.entries(ts?.by_owner ?? {}).map(([k, n]) => <tr key={k}><td>{k}</td><td className="num mono">{count(n)}</td></tr>)}</tbody>
            </table>
            <table className="cf__table cf__mini">
              <thead><tr><th>Action</th><th className="num">Trades</th></tr></thead>
              <tbody>{Object.entries(ts?.by_action ?? {}).map(([k, n]) => <tr key={k}><td>{k}</td><td className="num mono">{count(n)}</td></tr>)}</tbody>
            </table>
          </div>
          <table className="cf__table">
            <thead><tr><th>Date</th><th>Owner</th><th>Action</th><th>Ticker</th><th>Asset as filed</th><th className="num">Range</th><th>Public from</th></tr></thead>
            <tbody>
              {trades.slice(0, TOP_TRADES).map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.date ?? "—"}</td><td>{t.owner}</td><td>{t.action}</td><td className="mono">{t.ticker ?? "—"}</td>
                  <td className="cf__small">{t.asset}</td><td className="num mono">{rowAmount({ exact: null, low: t.low, high: t.high })}</td><td className="mono">{t.available ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="cf__sec cf__sources">
        <h3>Sources and method</h3>
        <table className="cf__table">
          <thead><tr><th>Source</th><th>Revision</th><th>Retrieved</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}><td>{s.name ?? s.id}{s.url ? <span className="cf__small"> · {String(s.url)}</span> : null}</td><td className="mono cf__small">{s.revision ? String(s.revision).slice(0, 40) : "—"}</td><td className="mono">{s.retrieved ? date(String(s.retrieved)) : "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="cf__method">
          <li>A tie exists only when a filed public record names both ends, or when a published statistical rule is met. Statistical ties are marked.</li>
          <li>Trade amounts are the disclosed ranges; no midpoint is stored or implied. Owner is shown as filed; an unstated owner is “unspecified”, never assumed to be the member.</li>
          <li>Missing values are left missing, never filled in. Method in full: {SITE.url}/method</li>
        </ul>
        <p className="cf__notice">{USE_NOTICE}</p>
        <p className="cf__notice">Not investment advice.</p>
        <p className="cf__notice">Live case file: {liveUrl} · Full file: {fullUrl} · {no}</p>
      </section>
    </div>
  );
}
