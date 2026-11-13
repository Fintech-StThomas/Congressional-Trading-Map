/** Two pins and a length of string: the site's mark. */
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <svg className="wordmark" viewBox="0 0 40 24" width={size * (40 / 24)} height={size} aria-hidden="true">
      <path d="M6 7 Q20 22 34 9" fill="none" stroke="var(--red-under)" strokeWidth="3.4" strokeLinecap="round" transform="translate(0.5 1.2)" />
      <path d="M6 7 Q20 22 34 9" fill="none" stroke="var(--red)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="6" cy="7" r="3.6" fill="var(--pin)" />
      <circle cx="34" cy="9" r="3.6" fill="var(--pin)" />
      <circle cx="5" cy="6" r="1.1" fill="var(--pin-glint)" />
      <circle cx="33" cy="8" r="1.1" fill="var(--pin-glint)" />
    </svg>
  );
}
