// The entry link to /connect from a member page or an organisation page, with that page's node as the first end.
import Link from "next/link";
import { CONNECT } from "@/lib/copy";
import { connectHref } from "@/lib/urls";

/** `className` restyles the link (the member page lists it in its action menu). */
export function ConnectLink({ a, className = "btn no-print" }: { a: string; className?: string }) {
  return (
    <Link className={className} href={connectHref({ a })}>
      {CONNECT.link}
    </Link>
  );
}
