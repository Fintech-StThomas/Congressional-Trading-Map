// One notice pattern for the whole site: the sample band, the stale-data banner, the newer-data note, the release
// banner, the snapshot note and the coverage notes. Tone picks the surface (info, warning, snapshot); the left rule,
// spacing and type are the same for all. `band` is the full-width form that sits under the header. Never red:
// red means a tie and nothing else. Styles are in styles/notices.css. Server or client.
import type { ComponentPropsWithoutRef } from "react";

export type NoticeTone = "info" | "warning" | "snapshot";

type Props = Omit<ComponentPropsWithoutRef<"aside">, "className"> & {
  tone?: NoticeTone;
  /** Full-width, under the header, instead of a block inside the page. */
  band?: boolean;
  /** Extra classes for the page's own hooks (for example `covnote`, `no-print`). */
  className?: string;
};

export function Notice({ tone = "info", band = false, className, role = "note", children, ...rest }: Props) {
  const cls = ["notice", `notice--${tone}`, band ? "notice--band" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <aside className={cls} role={role} {...rest}>
      {children}
    </aside>
  );
}
