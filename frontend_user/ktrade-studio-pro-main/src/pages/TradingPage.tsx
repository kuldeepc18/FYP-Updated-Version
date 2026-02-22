import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrdersPanel } from '@/components/OrdersPanel';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { MarketDepthPanel } from '@/components/MarketDepthPanel';
import { InstrumentsPanel } from '@/components/InstrumentsPanel';
import { HistoricalDataPanel } from '@/components/HistoricalDataPanel';
import { TradeModal } from '@/components/TradeModal';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setSelectedSymbol, setSymbols } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, List, History, BarChart3, Bookmark } from 'lucide-react';

const TradingPage = () => {
  const { symbol: urlSymbol } = useParams<{ symbol: string }>();
  const dispatch = useAppDispatch();
  const selectedSymbol = useAppSelector((state) => state.trading.selectedSymbol);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalSide, setTradeModalSide] = useState<'BUY' | 'SELL'>('BUY');
  const [activeTab, setActiveTab] = useState('instruments');
  const [symbolData, setSymbolData] = useState<any>(null);

  const symbol = urlSymbol || selectedSymbol || 'RELIANCE';

  useEffect(() => {
    if (symbol) {
      dispatch(setSelectedSymbol(symbol));
    }

    const loadData = async () => {
      const symbols = await marketDataService.getSymbols();
      dispatch(setSymbols(symbols));
      
      const data = await marketDataService.getSymbol(symbol);
      setSymbolData(data);
    };
    loadData();
  }, [symbol, dispatch]);

  const handleBuy = () => {
    setTradeModalSide('BUY');
    setTradeModalOpen(true);
  };

  const handleSell = () => {
    setTradeModalSide('SELL');
    setTradeModalOpen(true);
  };

  const isPositive = (symbolData?.changePercent || 0) >= 0;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-background">
      {/* Symbol Info Header */}
      <div className="px-6 py-4 border-b bg-card flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <h2 className="text-xl font-bold">{symbol}</h2>
            <p className="text-xs text-muted-foreground">{symbolData?.name}</p>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">₹{symbolData?.price.toFixed(2)}</span>
            <div className={`flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
              {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              <span>{isPositive ? '+' : ''}{symbolData?.changePercent?.toFixed(2)}%</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-6 text-sm border-l pl-6">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Open</span>
              <span className="font-medium">₹{(symbolData?.price ? symbolData.price - (symbolData.change || 0) : 0).toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">High</span>
              <span className="font-medium text-success">₹{(symbolData?.price ? symbolData.price * 1.02 : 0).toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Low</span>
              <span className="font-medium text-destructive">₹{(symbolData?.price ? symbolData.price * 0.98 : 0).toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Volume</span>
              <span className="font-medium">1.2M</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button onClick={handleBuy} size="lg" className="bg-success hover:bg-success/90 text-white px-6">
            <TrendingUp className="w-4 h-4 mr-2" />
            BUY
          </Button>
          <Button onClick={handleSell} size="lg" variant="destructive" className="px-6">
            <TrendingDown className="w-4 h-4 mr-2" />
            SELL
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Tabs for Instruments/Watchlist */}
        <div className="w-80 border-r flex flex-col bg-card">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="w-full grid grid-cols-2 rounded-none border-b h-11 bg-muted/30">
              <TabsTrigger value="instruments" className="rounded-none data-[state=active]:bg-background gap-2">
                <List className="w-4 h-4" />
                Instruments
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="rounded-none data-[state=active]:bg-background gap-2">
                <Bookmark className="w-4 h-4" />
                Watchlist
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

        {/* Center Panel - Market Depth & Historical */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
            {/* Market Depth */}
            <div className="border-r overflow-hidden">
              <MarketDepthPanel symbol={symbol} />
            </div>

            {/* Historical Data */}
            <div className="overflow-hidden">
              <HistoricalDataPanel symbol={symbol} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Orders & Positions */}
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
