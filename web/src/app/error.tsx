"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page page--narrow">
      <h1>This page failed to load</h1>
      <p className="lede">Something broke while drawing it. The data is unaffected.</p>
      <p className="lede">
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>{" "}
        <Link href="/">Back to the board</Link>
      </p>
    </div>
  );
}
