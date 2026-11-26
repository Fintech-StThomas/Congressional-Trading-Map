// Display labels for a trade's owner, action and asset class, shared by the member trades table, the
// "Around this trade" panel and /flags, and the table's sort order.
import type { Trade } from "@/lib/types";

export const OWNER_LABEL: Record<Trade["owner"], string> = {
  self: "Self", spouse: "Spouse", joint: "Joint", dependent: "Dependent", unspecified: "Unspecified",
};
export const ACTION_LABEL: Record<Trade["action"], string> = { buy: "Buy", sell: "Sell", exchange: "Exchange", other: "Other" };
export const CLASS_LABEL: Record<Trade["asset_class"], string> = {
  stock: "Stock", option: "Option", fund: "Fund", bond: "Bond", crypto: "Crypto", private: "Private", other: "Other", unknown: "Unknown",
};

export function actionLabel(a: string): string {
  return ACTION_LABEL[a as Trade["action"]] ?? a;
}

/** Sort order of two rows by one field: missing values last, numbers by value, the rest as text. */
export function cmp<T>(a: T, b: T, k: keyof T): number {
  const va = a[k], vb = b[k];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}
