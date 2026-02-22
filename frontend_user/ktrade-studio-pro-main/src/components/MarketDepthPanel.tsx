import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarketDepth } from '@/types/trading';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';

interface MarketDepthPanelProps {
  symbol: string;
}

export const MarketDepthPanel = ({ symbol }: MarketDepthPanelProps) => {
  const [depth, setDepth] = useState<MarketDepth | null>(null);

  useEffect(() => {
    const loadDepth = async () => {
      try {
        const d = await marketDataService.getMarketDepth(symbol);
        setDepth(d);
      } catch (error) {
        console.error('Failed to load market depth:', error);
        setDepth({ bids: [], asks: [], lastUpdate: Date.now() });
      }
    };

    loadDepth();
    const interval = setInterval(loadDepth, 2000);

    return () => clearInterval(interval);
  }, [symbol]);

  if (!depth || !depth.bids || !depth.asks) return null;

  const maxBidQty = depth.bids.length > 0 ? Math.max(...depth.bids.map((b) => b.quantity)) : 0;
  const maxAskQty = depth.asks.length > 0 ? Math.max(...depth.asks.map((a) => a.quantity)) : 0;
  const maxQty = Math.max(maxBidQty, maxAskQty);

  const totalBidQty = depth.bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalAskQty = depth.asks.reduce((sum, a) => sum + a.quantity, 0);
  const totalQty = totalBidQty + totalAskQty;
  const buyPercent = totalQty > 0 ? (totalBidQty / totalQty) * 100 : 50;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-muted/20">
        <h3 className="font-semibold text-sm">Market Depth</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Order book for {symbol}</p>
      </div>

      {/* Buy/Sell Pressure Bar */}
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-success font-medium">Buyers {buyPercent.toFixed(0)}%</span>
          <span className="text-destructive font-medium">Sellers {(100 - buyPercent).toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex">
          <div 
            className="bg-success transition-all" 
            style={{ width: `${buyPercent}%` }}
          />
          <div 
            className="bg-destructive transition-all"
            style={{ width: `${100 - buyPercent}%` }}
          />
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-3 text-xs font-medium text-muted-foreground px-3 py-2 border-b bg-muted/30">
        <span>Bid Qty</span>
        <span className="text-center">Price</span>
        <span className="text-right">Ask Qty</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {/* Combined view - show bid and ask on same row */}
          {Array.from({ length: 10 }).map((_, idx) => {
            const bid = depth.bids[idx];
            const ask = depth.asks[idx];
            const bidWidth = bid ? (bid.quantity / maxQty) * 100 : 0;
            const askWidth = ask ? (ask.quantity / maxQty) * 100 : 0;

            return (
              <div key={idx} className="grid grid-cols-3 text-sm relative">
                {/* Bid side */}
                <div className="relative py-2 px-3">
                  <div
                    className="absolute right-0 top-0 h-full bg-success/10"
                    style={{ width: `${bidWidth}%` }}
                  />
                  <span className="relative z-10 text-success font-medium">
                    {bid ? bid.quantity.toLocaleString() : '-'}
                  </span>
                </div>

                {/* Price */}
                <div className="py-2 px-3 text-center font-medium">
                  {bid ? `₹${bid.price.toFixed(2)}` : ask ? `₹${ask.price.toFixed(2)}` : '-'}
                </div>

                {/* Ask side */}
                <div className="relative py-2 px-3 text-right">
                  <div
                    className="absolute left-0 top-0 h-full bg-destructive/10"
                    style={{ width: `${askWidth}%` }}
                  />
                  <span className="relative z-10 text-destructive font-medium">
                    {ask ? ask.quantity.toLocaleString() : '-'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Totals */}
      <div className="grid grid-cols-3 text-xs font-semibold px-3 py-2 border-t bg-muted/30">
        <span className="text-success">{totalBidQty.toLocaleString()}</span>
        <span className="text-center text-muted-foreground">Total</span>
        <span className="text-right text-destructive">{totalAskQty.toLocaleString()}</span>
      </div>
    </div>
  );
};
