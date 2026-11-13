import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page--narrow notfound">
      <svg viewBox="0 0 240 90" width="240" height="90" aria-hidden="true" className="notfound__art">
        <path d="M20 20 Q70 70 118 40" fill="none" stroke="var(--red-under)" strokeWidth="4" strokeLinecap="round" transform="translate(0.6 1.6)" />
        <path d="M20 20 Q70 70 118 40" fill="none" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" />
        <path d="M118 40 Q126 56 122 78" fill="none" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 6" />
        <circle cx="20" cy="20" r="6" fill="var(--pin)" />
        <circle cx="18.4" cy="18.4" r="1.8" fill="var(--pin-glint)" />
        <rect x="150" y="18" width="70" height="52" fill="none" stroke="var(--rule)" strokeDasharray="4 4" />
      </svg>
      <h1>The string goes nowhere</h1>
      <p className="lede">There is no page at this address. The member, organisation or case may not be in this build.</p>
      <p className="lede">
        <Link href="/">Back to the board</Link> · <Link href="/cases">Open cases</Link> · <Link href="/method">Method</Link>
      </p>
    </div>
  );
}
