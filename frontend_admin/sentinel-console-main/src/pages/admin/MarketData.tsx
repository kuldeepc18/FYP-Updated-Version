import { useState, useEffect, useRef, useCallback } from "react";
import { getMarketInstruments, type MarketInstrument } from "@/data/apiMarketData";
import { cn } from "@/lib/utils";

const POLL_MS     = 1500; // refresh every 1.5 seconds for live feel
const FLASH_MS    = 700;  // how long the flash highlight lasts

function fmtTimestamp(iso: string): string {
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

function fmtQty(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString();
}

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

// Per-cell flash state: 'up' | 'down' | null
type FlashDir = "up" | "down" | null;

interface FlashMap {
  [instId: string]: {
    price   : FlashDir;
    change  : FlashDir;
    volume  : FlashDir;
    high    : FlashDir;
    low     : FlashDir;
  };
}

function getCellClass(dir: FlashDir): string {
  if (dir === "up")   return "bg-green-500/20 transition-colors duration-300";
  if (dir === "down") return "bg-red-500/20 transition-colors duration-300";
  return "transition-colors duration-700";
}

export default function MarketData() {
  const [instruments, setInstruments] = useState<MarketInstrument[]>([]);
  const [loading, setLoading]         = useState(true);
  const [online, setOnline]           = useState<boolean | null>(null);
  const [lastUpdate, setLastUpdate]   = useState(new Date());
  const [flashMap, setFlashMap]       = useState<FlashMap>({});

  // Store previous values to compare against new ones
  const prevRef      = useRef<Record<string, MarketInstrument>>({});
  const fetchingRef  = useRef(false);
  const flashTimers  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await getMarketInstruments();
      if (data.length === 0) {
        setOnline(true); // connected, just no data yet
        return;
      }

      // Compute flash directions by comparing to previous values
      const newFlash: FlashMap = {};
      data.forEach((inst) => {
        const prev = prevRef.current[inst.instrument_id];
        if (!prev) return; // first load, no comparison
        const dir = (n: number, o: number): FlashDir =>
          n > o ? "up" : n < o ? "down" : null;
        newFlash[inst.instrument_id] = {
          price  : dir(inst.last_price,    prev.last_price),
          change : dir(inst.change,        prev.change),
          volume : dir(inst.volume_qty,    prev.volume_qty),
          high   : dir(inst.high24h,       prev.high24h),
          low    : dir(inst.low24h,        prev.low24h),      // low going down is "worse"
        };
      });

      // Update prev map
      data.forEach((inst) => { prevRef.current[inst.instrument_id] = inst; });

      setInstruments(data);
      setLastUpdate(new Date());
      setOnline(true);

      if (Object.keys(newFlash).length > 0) {
        setFlashMap(newFlash);
        // Clear flash highlights after FLASH_MS
        const key = "global";
        if (flashTimers.current[key]) clearTimeout(flashTimers.current[key]);
        flashTimers.current[key] = setTimeout(() => {
          setFlashMap({});
        }, FLASH_MS);
      }
    } catch {
      setOnline(false);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      clearInterval(iv);
      Object.values(flashTimers.current).forEach(clearTimeout);
    };
  }, [load]);

  const totalVolumeQty = instruments.reduce((s, i) => s + i.volume_qty, 0);
  const gainers        = instruments.filter((i) => i.change > 0).length;
  const losers         = instruments.filter((i) => i.change < 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Market Data</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-instrument 24h stats from QuestDB · live feed refreshes every {POLL_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <LiveIndicator online={online} />
          <div className="flex items-center gap-2">
            <span className="data-label">Last Update</span>
            <span className="data-value font-mono">{fmtTimestamp(lastUpdate.toISOString())}</span>
          </div>
        </div>
      </div>

      {online === false && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          Backend is offline — showing last known data. Updates resume automatically when backend restarts.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="panel"><div className="p-4">
          <p className="data-label">Total Instruments</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{loading ? "—" : instruments.length}</p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">24h Volume (units)</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{loading ? "—" : fmtQty(totalVolumeQty)}</p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Gainers</p>
          <p className="text-2xl font-semibold text-positive mt-1">{loading ? "—" : gainers}</p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Losers</p>
          <p className="text-2xl font-semibold text-negative mt-1">{loading ? "—" : losers}</p>
        </div></div>
      </div>

      {/* All Instruments table */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">All Instruments</h2>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live · cells flash green/red on change · {POLL_MS / 1000}s refresh
          </span>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : instruments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No data yet — start the matching engine to populate market data.
            </p>
          ) : (
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Instrument Name</th>
                  <th className="text-right">Last Price</th>
                  <th className="text-right">24H Change</th>
                  <th className="text-right">24H %</th>
                  <th className="text-right">24H Volume</th>
                  <th className="text-right">24H High</th>
                  <th className="text-right">24H Low</th>
                  <th className="text-right">Last Trade Time</th>
                </tr>
              </thead>
              <tbody>
                {instruments.map((inst) => {
                  const isUp  = inst.change >= 0;
                  const flash = flashMap[inst.instrument_id];
                  return (
                    <tr key={inst.instrument_id}>
                      <td className="font-mono text-muted-foreground text-xs">{inst.instrument_id}</td>
                      <td>
                        <div className="font-medium text-foreground">{inst.instrument_name}</div>
                        <div className="text-xs text-muted-foreground">{inst.symbol}</div>
                      </td>

                      {/* Last Price — flashes + direction arrow */}
                      <td className={cn("text-right font-mono font-semibold", getCellClass(flash?.price ?? null))}>
                        <span className="mr-1 text-xs">
                          {flash?.price === "up" ? "▲" : flash?.price === "down" ? "▼" : ""}
                        </span>
                        {fmtNum(inst.last_price)}
                      </td>

                      {/* 24H Change */}
                      <td className={cn("text-right font-mono", isUp ? "text-positive" : "text-negative", getCellClass(flash?.change ?? null))}>
                        {isUp ? "+" : ""}{fmtNum(inst.change)}
                      </td>

                      {/* 24H % */}
                      <td className={cn("text-right font-mono", isUp ? "text-positive" : "text-negative")}>
                        {isUp ? "+" : ""}{fmtNum(inst.change_percent)}%
                      </td>

                      {/* Volume */}
                      <td className={cn("text-right font-mono text-muted-foreground", getCellClass(flash?.volume ?? null))}>
                        {fmtQty(inst.volume_qty)}
                      </td>

                      {/* High */}
                      <td className={cn("text-right font-mono text-muted-foreground", getCellClass(flash?.high ?? null))}>
                        {fmtNum(inst.high24h)}
                      </td>

                      {/* Low */}
                      <td className={cn("text-right font-mono text-muted-foreground", getCellClass(flash?.low ?? null))}>
                        {fmtNum(inst.low24h)}
                      </td>

                      <td className="text-right font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {fmtTimestamp(inst.latest_timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
