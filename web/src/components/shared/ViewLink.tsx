"use client";
// A link to another page of the site that carries the current view state (years, assumptions, selected tie, date
// basis) along, for server-rendered pages that cannot read the URL themselves.
import Link from "next/link";
import type { ComponentProps } from "react";
import { withView } from "@/lib/domain/viewstate";
import { useView } from "./useViewState";

export function ViewLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const view = useView();
  return <Link href={withView(href, view)} {...rest} />;
}
