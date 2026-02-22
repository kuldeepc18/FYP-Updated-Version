import { useState, useEffect, useRef } from "react";
import { type OrderBookData, type OrderLevel, type AskLevel } from "@/data/apiMarketData";
import { cn } from "@/lib/utils";

const MAX_LEVELS = 5;    // 5 bid levels + 5 ask levels
const FLASH_MS   = 500;  // duration of flash highlight

// SSE stream base — mirrors VITE_API_URL or the default admin-api base
const API_STREAM_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3000/api/admin';

function getStoredToken(): string {
  try {
    const stored = localStorage.getItem('adminSession');
    if (stored) {
      const parsed = JSON.parse(stored) as { token?: string };
      return parsed.token ?? '';
    }
  } catch { /* ignore */ }
  return '';
}

const INSTRUMENTS = [
  { id:  "1",  name: "Reliance Industries",        symbol: "RELIANCE"   },
  { id:  "2",  name: "Tata Consultancy Services",  symbol: "TCS"        },
  { id:  "3",  name: "Dixon Technologies",          symbol: "DIXON"      },
  { id:  "4",  name: "HDFC Bank",                  symbol: "HDFCBANK"   },
  { id:  "5",  name: "Tata Motors",                symbol: "TATAMOTORS" },
  { id:  "6",  name: "Tata Power",                 symbol: "TATAPOWER"  },
  { id:  "7",  name: "Adani Enterprises",          symbol: "ADANIENT"   },
  { id:  "8",  name: "Adani Green Energy",         symbol: "ADANIGREEN" },
  { id:  "9",  name: "Adani Power",                symbol: "ADANIPOWER" },
  { id: "10",  name: "Tanla Platforms",            symbol: "TANLA"      },
  { id: "11",  name: "Nifty 50 Index",             symbol: "NIFTY 50"  },
  { id: "12",  name: "Bank Nifty Index",           symbol: "BANKNIFTY"  },
  { id: "13",  name: "FinNifty",                   symbol: "FINNIFTY"   },
  { id: "14",  name: "Sensex",                     symbol: "SENSEX"     },
  { id: "15",  name: "Nifty Next 50 Index",        symbol: "NIFTYNXT50" },
] as const;

function fmtNum(n: number, d = 2) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

function fmtQty(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtTime(d: Date) {
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function LiveIndicator({ online, reconnecting }: { online: boolean | null; reconnecting: boolean }) {
  if (online === null && !reconnecting)
    return <span className="text-xs text-muted-foreground">Connecting…</span>;
  if (reconnecting)
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-500">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
        </span>
        Reconnecting…
      </span>
    );
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
        {online ? "Live" : "Backend offline — data frozen"}
      </span>
    </span>
  );
}

export default function OrderBook() {
  const [selectedId, setSelectedId]     = useState<string>("1");
  const [bookData, setBookData]         = useState<OrderBookData | null>(null);
  const [loading, setLoading]           = useState(true);
  const [online, setOnline]             = useState<boolean | null>(null);
  const [lastUpdate, setLastUpdate]     = useState(new Date());
  // Sets of price strings whose qty changed since last poll — used for flash
  const [bidFlash, setBidFlash]         = useState<Set<number>>(new Set());
  const [askFlash, setAskFlash]         = useState<Set<number>>(new Set());
  const [tickCount, setTickCount]       = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const prevBidsRef = useRef<Record<number, number>>({});
  const prevAsksRef = useRef<Record<number, number>>({});
  const flashTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef       = useRef<EventSource | null>(null);

  // Open an SSE connection whenever the selected instrument changes.
  // Manual reconnect loop: on error, close the dead connection and re-open
  // after 2 s, preserving the last known book data for continuity.
  useEffect(() => {
    prevBidsRef.current = {};
    prevAsksRef.current = {};
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setBidFlash(new Set());
    setAskFlash(new Set());
    setLoading(true);
    setOnline(null);
    setBookData(null);
    setTickCount(0);
    setReconnecting(false);

    let destroyed = false;                            // set true on cleanup
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      const token = getStoredToken();
      const url   = `${API_STREAM_BASE}/orders/book/${selectedId}/stream` +
                    `?token=${encodeURIComponent(token)}`;

      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (ev) => {
        if (destroyed) return;
        try {
          const data = JSON.parse(ev.data as string) as
            { error?: string } & OrderBookData & { server_ts?: number };

          if (data.error) { setOnline(false); setLoading(false); return; }

          // Detect which price levels changed qty since the last push
          const changedBids = new Set<number>();
          const changedAsks = new Set<number>();
          (data.bids ?? []).slice(0, MAX_LEVELS).forEach((b) => {
            if (prevBidsRef.current[b.price] !== undefined &&
                prevBidsRef.current[b.price] !== b.qty_buyers)
              changedBids.add(b.price);
          });
          (data.asks ?? []).slice(0, MAX_LEVELS).forEach((a) => {
            if (prevAsksRef.current[a.price] !== undefined &&
                prevAsksRef.current[a.price] !== a.qty_sellers)
              changedAsks.add(a.price);
          });
          (data.bids ?? []).forEach((b) => { prevBidsRef.current[b.price] = b.qty_buyers; });
          (data.asks ?? []).forEach((a) => { prevAsksRef.current[a.price] = a.qty_sellers; });

          setBookData(data);
          setLastUpdate(new Date());
          setTickCount((c) => c + 1);
          setOnline(true);
          setReconnecting(false);
          setLoading(false);

          if (changedBids.size > 0 || changedAsks.size > 0) {
            setBidFlash(changedBids);
            setAskFlash(changedAsks);
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => {
              setBidFlash(new Set());
              setAskFlash(new Set());
            }, FLASH_MS);
          }
        } catch {
          setOnline(false);
          setLoading(false);
        }
      };

      es.onerror = () => {
        if (destroyed) return;
        es.close();                  // kill the broken connection
        esRef.current = null;
        setOnline(false);
        setReconnecting(true);
        setLoading(false);
        // Re-open after 2 s — preserves last known book data on screen
        retryTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [selectedId]);

  // Cap at MAX_LEVELS per side (backend already returns MAX_LEVELS but guard here too)
  const bids = (bookData?.bids  ?? []).slice(0, MAX_LEVELS);
  const asks = (bookData?.asks  ?? []).slice(0, MAX_LEVELS);
  const rows = Math.max(bids.length, asks.length);

  // Max qty for depth bars
  const maxBidQty = bids.reduce((m, b) => Math.max(m, b.qty_buyers),  1);
  const maxAskQty = asks.reduce((m, a) => Math.max(m, a.qty_sellers), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Order Book Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Top {MAX_LEVELS} BID / ASK levels · server-push SSE every 250 ms · qty cells flash on change
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <LiveIndicator online={online} reconnecting={reconnecting} />
          <div className="flex items-center gap-2">
            <span className="data-label">Last Update</span>
            <span className="font-mono text-foreground">{fmtTime(lastUpdate)}</span>
          </div>
          {tickCount > 0 && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              tick #{tickCount}
            </span>
          )}
        </div>
      </div>

      {(online === false && !reconnecting) && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          Backend is offline — order book updates are paused. Showing last known state. Resumes automatically when backend restarts.
        </div>
      )}

      {reconnecting && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 px-4 py-3 text-sm text-yellow-600 dark:text-yellow-400">
          Connection lost — reconnecting to live feed… last known data shown below.
        </div>
      )}

      {/* Instrument selector */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Select Instrument</h2>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst.id}
              onClick={() => setSelectedId(inst.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                selectedId === inst.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80"
              )}
              title={inst.name}
            >
              {inst.symbol}
            </button>
          ))}
        </div>
        {bookData && (
          <div className="px-4 pb-3 text-sm text-muted-foreground">
            Showing: <span className="text-foreground font-medium">{bookData.instrument_name}</span>
            <span className="ml-2 text-xs">({bookData.symbol})</span>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="panel"><div className="p-4">
          <p className="data-label">Bid Levels (shown)</p>
          <p className="text-2xl font-semibold text-positive mt-1">{loading ? "—" : bids.length}</p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Ask Levels (shown)</p>
          <p className="text-2xl font-semibold text-negative mt-1">{loading ? "—" : asks.length}</p>
        </div></div>
        <div className="panel"><div className="p-4">
          <p className="data-label">Spread</p>
          <p className="text-2xl font-semibold text-foreground mt-1">
            {loading || bids.length === 0 || asks.length === 0
              ? "—"
              : fmtNum(asks[0].price - bids[0].price)}
          </p>
        </div></div>
      </div>

      {/* Combined order book table */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            Order Depth &mdash;{" "}
            {bookData ? bookData.instrument_name : INSTRUMENTS.find(i => i.id === selectedId)?.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">Top {MAX_LEVELS} levels per side</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            <span className="text-positive font-medium">Bids</span> (buyers, high→low) vs{" "}
            <span className="text-negative font-medium">Asks</span> (sellers, low→high)
          </span>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading order book…</p>
          ) : rows === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No pending orders for this instrument. Orders with status NEW or PARTIAL will appear here.
            </p>
          ) : (
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="text-right text-positive">Qty (Buyers)</th>
                  <th className="text-right text-positive">Bid Price</th>
                  <th className="w-32 text-center text-muted-foreground text-xs">#</th>
                  <th className="text-left  text-negative">Ask Price</th>
                  <th className="text-left  text-negative">Qty (Sellers)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }).map((_, i) => {
                  const bid = bids[i];
                  const ask = asks[i];
                  const bidBar    = bid ? Math.round((bid.qty_buyers  / maxBidQty) * 60) : 0;
                  const askBar    = ask ? Math.round((ask.qty_sellers / maxAskQty) * 60) : 0;
                  const bidChanged = bid && bidFlash.has(bid.price);
                  const askChanged = ask && askFlash.has(ask.price);
                  return (
                    <tr key={i}>
                      {/* BID quantity — flashes green when qty changes */}
                      <td className={cn(
                        "text-right font-mono text-positive transition-all duration-300",
                        bidChanged && "bg-green-400/40 scale-105"
                      )}>
                        {bid ? fmtQty(bid.qty_buyers) : ""}
                      </td>
                      {/* BID price with depth bar */}
                      <td className="text-right relative pr-2">
                        {bid && (
                          <>
                            <span
                              className="absolute inset-y-0 right-0 bg-positive/10"
                              style={{ width: `${bidBar}%` }}
                            />
                            <span className="relative font-mono text-positive font-semibold">
                              {fmtNum(bid.price)}
                            </span>
                          </>
                        )}
                      </td>
                      {/* Level index */}
                      <td className="text-center text-xs text-muted-foreground">{i + 1}</td>
                      {/* ASK price with depth bar */}
                      <td className="text-left relative pl-2">
                        {ask && (
                          <>
                            <span
                              className="absolute inset-y-0 left-0 bg-negative/10"
                              style={{ width: `${askBar}%` }}
                            />
                            <span className="relative font-mono text-negative font-semibold">
                              {fmtNum(ask.price)}
                            </span>
                          </>
                        )}
                      </td>
                      {/* ASK quantity — flashes red when qty changes */}
                      <td className={cn(
                        "text-left font-mono text-negative transition-all duration-300",
                        askChanged && "bg-red-400/40 scale-105"
                      )}>
                        {ask ? fmtQty(ask.qty_sellers) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-positive" /> Server-push SSE from matching engine · {MAX_LEVELS} bid + {MAX_LEVELS} ask levels · every 250 ms
        </span>
        <span>Bids sorted high→low · Asks sorted low→high</span>
      </div>
    </div>
  );
}
