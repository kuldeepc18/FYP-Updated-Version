import { useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrdersPanel } from '@/components/OrdersPanel';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { MarketDepthPanel } from '@/components/MarketDepthPanel';
import { InstrumentsPanel } from '@/components/InstrumentsPanel';
import { TradeModal } from '@/components/TradeModal';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setSelectedSymbol, setSymbols, setPositions } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { orderServiceApi } from '@/services';
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, List, Bookmark } from 'lucide-react';
import { Symbol } from '@/types/trading';
import { cn } from '@/lib/utils';

const TradingPage = () => {
  const { symbol: urlSymbol } = useParams<{ symbol: string }>();
  const dispatch          = useAppDispatch();
  const symbols           = useAppSelector((s) => s.trading.symbols);
  const selectedSymbol    = useAppSelector((s) => s.trading.selectedSymbol);

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalSide, setTradeModalSide] = useState<'BUY' | 'SELL'>('BUY');
  const [activeLeftTab, setActiveLeftTab]   = useState('instruments');

  const posIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Decoded symbol from URL param (handles spaces that were encoded)
  const symbol = urlSymbol ? decodeURIComponent(urlSymbol) : (selectedSymbol || 'RELIANCE (NSE)');

  // Start SSE market-data stream and populate symbols store
  const handleMarketUpdate = useCallback(
    (updated: Symbol[]) => { dispatch(setSymbols(updated)); },
    [dispatch]
  );

  useEffect(() => {
    dispatch(setSelectedSymbol(symbol));
    marketDataService.onMarketUpdate(handleMarketUpdate);
    marketDataService.startRealtimeStream();
    // Fetch initial snapshot immediately
    marketDataService.getSymbols().then((syms) => dispatch(setSymbols(syms)));

    return () => { marketDataService.offMarketUpdate(handleMarketUpdate); };
  }, [symbol, dispatch, handleMarketUpdate]);

  // Poll positions every 3 s
  useEffect(() => {
    const fetchPositions = async () => {
      try {
        const pos = await orderServiceApi.getPositions();
        dispatch(setPositions(pos));
      } catch { /* silent */ }
    };
    fetchPositions();
    posIntervalRef.current = setInterval(fetchPositions, 3000);
    return () => { if (posIntervalRef.current) clearInterval(posIntervalRef.current); };
  }, [dispatch]);

  // Live data for selected symbol
  const symData     = symbols.find((s) => s.symbol === symbol);
  const ltp         = symData?.price ?? 0;
  const change      = symData?.change ?? 0;
  const changePct   = symData?.changePercent ?? 0;
  const high24h     = symData?.high ?? ltp;
  const low24h      = symData?.low  ?? ltp;
  const open24h     = symData?.open ?? ltp;
  const volume      = symData?.volume ?? 0;
  const isPositive  = changePct >= 0;

  const handleBuy  = () => { setTradeModalSide('BUY');  setTradeModalOpen(true); };
  const handleSell = () => { setTradeModalSide('SELL'); setTradeModalOpen(true); };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-background overflow-hidden">

      {/* ── Symbol Info Header ─────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b bg-card flex items-center justify-between shrink-0">
        <div className="flex flex-wrap items-center gap-6">
          {/* Name + LTP + Change */}
          <div>
            <h2 className="text-lg font-bold leading-tight">{symbol}</h2>
            <p className="text-xs text-muted-foreground">{symData?.name || '—'}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">₹{ltp.toFixed(2)}</span>
            <div className={cn('flex items-center gap-1 px-2 py-1 rounded text-sm font-medium', isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
              {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              <span>{isPositive ? '+' : ''}₹{Math.abs(change).toFixed(2)}</span>
              <span>({isPositive ? '+' : ''}{changePct.toFixed(2)}%)</span>
            </div>
          </div>

          {/* OHLCV stats */}
          <div className="hidden md:flex items-center gap-5 text-sm border-l pl-5">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Open</span>
              <span className="font-medium">₹{open24h.toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">High</span>
              <span className="font-medium text-success">₹{high24h.toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Low</span>
              <span className="font-medium text-destructive">₹{low24h.toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Volume</span>
              <span className="font-medium">{volume > 0 ? volume.toLocaleString() : '—'}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 shrink-0">
          <Button onClick={handleBuy}  size="lg" className="bg-success hover:bg-success/90 text-white px-6">
            <TrendingUp className="w-4 h-4 mr-2" /> BUY
          </Button>
          <Button onClick={handleSell} size="lg" variant="destructive" className="px-6">
            <TrendingDown className="w-4 h-4 mr-2" /> SELL
          </Button>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Instruments / Watchlist */}
        <div className="w-72 border-r flex flex-col bg-card shrink-0">
          <Tabs value={activeLeftTab} onValueChange={setActiveLeftTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="w-full grid grid-cols-2 rounded-none border-b h-11 bg-muted/30 shrink-0">
              <TabsTrigger value="instruments" className="rounded-none data-[state=active]:bg-background gap-2">
                <List className="w-4 h-4" /> Instruments
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="rounded-none data-[state=active]:bg-background gap-2">
                <Bookmark className="w-4 h-4" /> Watchlist
              </TabsTrigger>
            </TabsList>
            <TabsContent value="instruments" className="flex-1 m-0 overflow-hidden">
              <InstrumentsPanel />
            </TabsContent>
            <TabsContent value="watchlist" className="flex-1 m-0 overflow-hidden">
              <WatchlistPanel />
            </TabsContent>
          </Tabs>
        </div>

        {/* Center: Market Depth (full width, no chart panel) */}
        <div className="flex-1 overflow-hidden">
          <MarketDepthPanel symbol={symbol} />
        </div>
      </div>

      {/* ── Bottom: Orders Panel ──────────────────────────────────────── */}
      <OrdersPanel />

      <TradeModal
        symbol={symbol}
        open={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        defaultSide={tradeModalSide}
      />
    </div>
  );
};

export default TradingPage;
