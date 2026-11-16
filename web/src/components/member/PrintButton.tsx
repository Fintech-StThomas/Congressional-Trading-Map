"use client";
// Prints the member page; print CSS swaps in the case file (CaseFile.tsx). `className` restyles it (a menu item on the member page).
export function PrintButton({ className = "btn" }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()} title="Opens the print dialog; choose “Save as PDF” to keep a copy">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 6V2h8v4M4 12H2.5V6.5h11V12H12M4 9.5h8V14H4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      Print case file
    </button>
  );
}
