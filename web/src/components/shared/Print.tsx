import { tiltFor } from "@/lib/hash";

type Props = {
  id: string;
  name: string;
  photo: boolean;
  size?: "xl" | "lg" | "md" | "sm" | "xs";
  pinned?: boolean;
  tilt?: boolean;
  className?: string;
};

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s'-]/gu, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

/**
 * A pinned photographic print: paper border, a fixed small tilt per member,
 * a pin head and a soft shadow. Missing portraits get a blank print with the
 * member's initials rather than a stand-in face.
 */
export function Print({ id, name, photo, size = "md", pinned = true, tilt = true, className }: Props) {
  const deg = tilt ? tiltFor(id) : 0;
  return (
    <span
      className={`print print--${size}${className ? " " + className : ""}`}
      style={{ "--tilt": `${deg}deg` } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="print__frame">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- static portraits, fixed aspect, no optimiser needed
          <img src={`/portraits/${id}.webp`} alt="" width={300} height={366} loading="lazy" decoding="async" />
        ) : (
          <span className="print__blank">
            <span>{initials(name)}</span>
          </span>
        )}
      </span>
      {pinned && <span className="pin" />}
    </span>
  );
}

export function PartyTag({ party }: { party: "D" | "R" | "I" }) {
  const long = party === "D" ? "Democrat" : party === "R" ? "Republican" : "Independent";
  return (
    <abbr className="party" title={long}>
      {party}
    </abbr>
  );
}
