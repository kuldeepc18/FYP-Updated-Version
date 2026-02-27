import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface DepthLevel {
  price: number;
  quantity: number;
  orders?: number;
}

interface OrderBook {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  lastUpdate: number;
}

interface MarketDepthPanelProps {
  symbol: string;
}

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/api$/, '');

export const MarketDepthPanel = ({ symbol }: MarketDepthPanelProps) => {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [connected, setConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const connect = () => {
      // close any existing connection for a previous symbol
      sseRef.current?.close();

      const id  = encodeURIComponent(symbol);
      const url = `${API_BASE}/api/market/orderbook/${id}/stream`;
      const es  = new EventSource(url);
      sseRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data && !data.error) {
            setBook({
              symbol    : data.symbol || symbol,
              bids      : (data.bids || []).slice(0, 5),
              asks      : (data.asks || []).slice(0, 5),
              lastUpdate: data.lastUpdate || Date.now(),
            });
          }
        } catch { /* ignore */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        sseRef.current = null;
        // reconnect after 3 s
        setTimeout(connect, 3000);
      };
    };

    connect();
    return () => { sseRef.current?.close(); sseRef.current = null; };
  }, [symbol]);

  const bids = book?.bids || [];
  const asks = book?.asks || [];

  const maxBidQty = bids.length > 0 ? Math.max(...bids.map((b) => b.quantity)) : 1;
  const maxAskQty = asks.length > 0 ? Math.max(...asks.map((a) => a.quantity)) : 1;
  const maxQty    = Math.max(maxBidQty, maxAskQty, 1);

  const totalBid = bids.reduce((s, b) => s + b.quantity, 0);
  const totalAsk = asks.reduce((s, a) => s + a.quantity, 0);
  const total    = totalBid + totalAsk || 1;
  const buyPct   = (totalBid / total) * 100;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-muted/20 shrink-0 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Market Depth</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{symbol}</p>
        </div>
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', connected ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground')}>
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>

      {/* Buy/Sell pressure bar */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-success font-medium">Buyers {buyPct.toFixed(0)}%</span>
          <span className="text-destructive font-medium">Sellers {(100 - buyPct).toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex">
          <div className="bg-success transition-all" style={{ width: `${buyPct}%` }} />
          <div className="bg-destructive transition-all" style={{ width: `${100 - buyPct}%` }} />
        </div>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-3 text-xs font-medium text-muted-foreground px-3 py-2 border-b bg-muted/30 shrink-0">
        <span>Bid Qty</span>
        <span className="text-center">Price</span>
        <span className="text-right">Ask Qty</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => {
            const bid = bids[i];
            const ask = asks[i];
            const bw  = bid ? (bid.quantity / maxQty) * 100 : 0;
            const aw  = ask ? (ask.quantity / maxQty) * 100 : 0;
            return (
              <div key={i} className="grid grid-cols-3 text-sm">
                {/* Bid */}
                <div className="relative py-2 px-3">
                  <div className="absolute right-0 top-0 h-full bg-success/10" style={{ width: `${bw}%` }} />
                  <span className="relative z-10 text-success font-medium">
                    {bid ? bid.quantity.toLocaleString() : '—'}
                  </span>
                </div>
                {/* Price */}
                <div className="py-2 px-3 text-center font-medium">
                  {bid ? `₹${bid.price.toFixed(2)}` : ask ? `₹${ask.price.toFixed(2)}` : '—'}
                </div>
                {/* Ask */}
                <div className="relative py-2 px-3 text-right">
                  <div className="absolute left-0 top-0 h-full bg-destructive/10" style={{ width: `${aw}%` }} />
                  <span className="relative z-10 text-destructive font-medium">
                    {ask ? ask.quantity.toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            );
          })}
          {bids.length === 0 && asks.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-xs">
              No pending orders in book
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Totals */}
      <div className="grid grid-cols-3 text-xs font-semibold px-3 py-2 border-t bg-muted/30 shrink-0">
        <span className="text-success">{totalBid.toLocaleString()}</span>
        <span className="text-center text-muted-foreground">Total</span>
        <span className="text-right text-destructive">{totalAsk.toLocaleString()}</span>
      </div>
    </div>
  );
};
