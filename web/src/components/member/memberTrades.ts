// The member page's trade rows: the table lists every row, including those a later filing marks Deleted (marked, counted
// nowhere), while every figure and the printed list use the counted rows only (files without a not_counted map: all rows
// count). Listed rows can exist when no trade is counted, so the table is fed whenever the file has rows.
import { countedWire, decodeTradeFile, type TradeMarks, type TradeRow } from "@/lib/data/decode";

type Wire = ({ cols: string[]; rows: unknown[][]; filings?: Record<string, string> } & TradeMarks) | null;

export function memberTrades(tradeFile: Wire, nTrades: number, first = 60): { listedN: number; initialTrades: TradeRow[]; countedInitial: TradeRow[]; countedFile: ReturnType<typeof countedWire> } {
  const listedN = tradeFile?.rows.length ?? 0;
  const initialTrades = nTrades || listedN ? decodeTradeFile(tradeFile, first, { listed: true }) : [];
  return { listedN, initialTrades, countedInitial: initialTrades.filter((t) => !t.notCounted), countedFile: countedWire(tradeFile) };
}
