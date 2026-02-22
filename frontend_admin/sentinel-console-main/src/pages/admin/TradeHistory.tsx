import { useState, useEffect, useRef, useCallback } from "react";
import { getTradeHistory, getTradeStats, type TradeRecord, type TradeStats } from "@/data/apiMarketData";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;

type SideFilter   = "ALL" | "BUY" | "SELL";
type StatusFilter = "ALL" | "NEW" | "PARTIAL" | "FILLED" | "CANCELLED" | "EXPIRED";

function fmtTimestamp(iso: string): string {
  if (!iso) return "";
  const d    = new Date(iso);
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const hh   = String(d.getHours()).padStart(2, "0");
  const mm   = String(d.getMinutes()).padStart(2, "0");
  const ss   = String(d.getSeconds()).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const mo   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${hh}:${mm}:${ss}, ${days[d.getDay()]}, ${dd}-${mo}-${yyyy}`;
}

function fmtNum(n: number, d = 2) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

function fmtVol(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return fmtNum(n);
}

const STATUS_COLOR: Record<string, string> = {
  FILLED   : "bg-positive/20 text-positive",
  PARTIAL  : "bg-warning/20 text-warning",
  CANCELLED: "bg-destructive/20 text-destructive",
  EXPIRED  : "bg-muted text-muted-foreground",
  NEW      : "bg-secondary text-muted-foreground",
};

function LiveIndicator({ online }: { online: boolean | null }) {
  if (online === null) return <span className="text-xs text-muted-foreground">Connecting…</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="relative flex h-2 w-2">
        {online && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span className={cn(
          "relative inline-flex rounded-full h-2 w-2",
          online ? "bg-green-500" : "bg-red-500"
        )} />
      </span>
      <span className={online ? "text-green-500" : "text-red-500"}>
        {online ? "Live" : "Backend offline"}
      </span>
    </span>
  );
}

export default function TradeHistory() {
  const [trades, setTrades]             = useState<TradeRecord[]>([]);
  const [stats, setStats]               = useState<TradeStats | null>(null);
  const [loading, setLoading]           = useState(true);
  const [online, setOnline]             = useState<boolean | null>(null);
  const [sideFilter, setSideFilter]     = useState<SideFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [lastUpdate, setLastUpdate]     = useState(new Date());
  const fetchingRef                     = useRef(false);

  const load = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const params: Record<string, string> = { limit: "1000" };
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (sideFilter   !== "ALL") params.side   = sideFilter;

      const [data, s] = await Promise.all([
        getTradeHistory(params),
        getTradeStats(),
      ]);

      setTrades(data);
      setStats(s);
      setLastUpdate(new Date());
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [statusFilter, sideFilter]);

  useEffect(() => {
    // Reset the in-flight guard whenever filters change (new `load` reference).
    // Without this, a slow previous fetch would block the immediate re-fetch
    // triggered by the filter click, leaving stale data on screen until the
    // next poll interval fires (up to POLL_MS later).
    fetchingRef.current = false;
    setLoading(true);
    setOnline(null);
    load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      clearInterval(iv);
      fetchingRef.current = false; // abort guard on unmount / filter change
    };
  }, [load]);

  const SIDES: SideFilter[]      = ["ALL", "BUY", "SELL"];
  const STATUSES: StatusFilter[] = ["ALL", "NEW", "PARTIAL", "FILLED", "CANCELLED", "EXPIRED"];

  const fmtTime = (d: Date) =>
    `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Trade History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All order events from QuestDB trade_logs · refreshes every {POLL_MS / 1000}s · filters applied at DB level
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <LiveIndicator online={online} />
          <div className="flex items-center gap-2">
            <span className="data-label">Last Update</span>
            <span className="font-mono text-foreground">{fmtTime(lastUpdate)}</span>
          </div>
        </div>
      </div>

      {online === false && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          Backend is offline — showing last known data. Will resume automatically when backend restarts.
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="panel"><div className="p-4">
          <p className="data-label">Total Trades (all time)</p>
          <p className="text-2xl font-semibold text-foreground mt-1">
            {loading ? "—" : (stats?.total_trades ?? 0).toLocaleString()}
          </p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Total Volume</p>
          <p className="text-2xl font-semibold text-foreground mt-1">
            {loading ? "—" : fmtVol(stats?.total_volume ?? 0)}
          </p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Buy Volume</p>
          <p className="text-2xl font-semibold text-positive mt-1">
            {loading ? "—" : fmtVol(stats?.buy_volume ?? 0)}
          </p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Sell Volume</p>
          <p className="text-2xl font-semibold text-negative mt-1">
            {loading ? "—" : fmtVol(stats?.sell_volume ?? 0)}
          </p>
        </div></div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {SIDES.map((s) => (
            <button key={s} onClick={() => setSideFilter(s)}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                sideFilter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : s === "CANCELLED"
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : s === "EXPIRED"
                      ? "bg-muted text-muted-foreground hover:bg-muted/80"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground self-center">
          {trades.length.toLocaleString()} records
          {statusFilter !== "ALL" && ` · status: ${statusFilter}`}
          {sideFilter   !== "ALL" && ` · side: ${sideFilter}`}
        </span>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Order Log</h2>
          <span className="text-xs text-muted-foreground">
            Fetched from QuestDB with DB-level filters · sorted newest first
          </span>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : trades.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No records found
              {statusFilter !== "ALL" ? ` with status ${statusFilter}` : ""}
              {sideFilter !== "ALL" ? ` on ${sideFilter} side` : ""}
              {" "}in QuestDB.
            </p>
          ) : (
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>Inst ID</th>
                  <th>Instrument Name</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Filled</th>
                  <th className="text-right">Net Amount</th>
                  <th>User ID</th>
                  <th>Order ID</th>
                  <th>Status</th>
                  <th className="text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, idx) => (
                  <tr key={t.order_id + idx}>
                    <td className="font-mono text-xs text-muted-foreground">{t.instrument_id}</td>
                    <td className="font-medium text-foreground whitespace-nowrap">{t.instrument_name}</td>
                    <td>
                      <span className={cn("text-xs font-semibold",
                        t.side === "BUY" ? "text-positive" : "text-negative")}>
                        {t.side}
                      </span>
                    </td>
                    <td className="text-xs text-muted-foreground">{t.order_type}</td>
                    <td className="text-right font-mono">{fmtNum(t.price)}</td>
                    <td className="text-right font-mono">{fmtNum(t.quantity, 0)}</td>
                    <td className="text-right font-mono text-muted-foreground">{fmtNum(t.filled_quantity, 0)}</td>
                    <td className="text-right font-mono">{fmtNum(t.total)}</td>
                    <td className="font-mono text-xs text-muted-foreground">{t.user_id}</td>
                    <td className="font-mono text-xs text-muted-foreground">{t.order_id}</td>
                    <td>
                      <span className={cn("text-xs px-2 py-0.5 rounded",
                        STATUS_COLOR[t.status] ?? "bg-secondary text-muted-foreground")}>
                        {t.status}
                      </span>
                    </td>
                    <td className="text-right font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {fmtTimestamp(t.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
