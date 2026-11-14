"use client";
// The "Go to page" control under the /cases pager: picks a page and follows its static link.
import { useRouter } from "next/navigation";
import { CASES_COPY } from "@/lib/copy";

export function PageJump({ page, pages, hrefs }: { page: number; pages: number; hrefs: string[] }) {
  const router = useRouter();
  return (
    <label className="pager__jump">
      <span>{CASES_COPY.jump}</span>
      <select value={page} onChange={(e) => router.push(hrefs[Number(e.target.value) - 1])} aria-label={CASES_COPY.jump}>
        {Array.from({ length: pages }, (_, i) => (
          <option key={i} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
      <span className="sub">{CASES_COPY.of(pages)}</span>
    </label>
  );
}
