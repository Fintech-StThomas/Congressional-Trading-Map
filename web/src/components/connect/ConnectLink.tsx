// The entry link to /connect from a member page or an organisation page, with that page's node as the first end.
import Link from "next/link";
import { CONNECT } from "@/lib/copy";
import { connectHref } from "@/lib/urls";

export function ConnectLink({ a }: { a: string }) {
  return (
    <Link className="btn no-print" href={connectHref({ a })}>
      {CONNECT.link}
    </Link>
  );
}
