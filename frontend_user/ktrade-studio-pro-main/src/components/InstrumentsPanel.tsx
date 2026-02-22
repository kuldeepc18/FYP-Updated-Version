import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Search, Plus, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSelectedSymbol, addToWatchlist } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Symbol } from '@/types/trading';

export const InstrumentsPanel = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { selectedSymbol, watchlists, activeWatchlist } = useAppSelector(
    (state) => state.trading
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [allSymbols, setAllSymbols] = useState<Symbol[]>([]);

  useEffect(() => {
    const loadSymbols = async () => {
      const symbols = await marketDataService.getSymbols();
      setAllSymbols(symbols);
    };
    loadSymbols();
  }, []);

  const activeList = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols = activeList?.symbols || [];

  const filteredSymbols = searchQuery
    ? allSymbols.filter(
        (s) =>
          s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allSymbols;

  const handleSymbolClick = (symbol: string) => {
    dispatch(setSelectedSymbol(symbol));
    navigate(`/trade/${symbol}`);
  };

  const handleAddToWatchlist = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeList && !watchlistSymbols.includes(symbol)) {
      dispatch(addToWatchlist({ watchlistId: activeList.id, symbol }));
      toast.success(`${symbol} added to watchlist`);
    }
  };

  const isInWatchlist = (symbol: string) => watchlistSymbols.includes(symbol);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-muted/20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search instruments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {filteredSymbols.map((sym) => {
            const isSelected = selectedSymbol === sym.symbol;
            const isPositive = (sym.changePercent || 0) >= 0;
            const inWatchlist = isInWatchlist(sym.symbol);

            return (
              <div
                key={sym.symbol}
                className={cn(
                  'p-3 cursor-pointer hover:bg-muted/50 transition-colors flex items-center justify-between',
                  isSelected && 'bg-primary/5 border-l-2 border-l-primary'
                )}
                onClick={() => handleSymbolClick(sym.symbol)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{sym.symbol}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {sym.exchange}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{sym.name}</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-semibold text-sm">₹{sym.price.toFixed(2)}</div>
                    <div className={cn(
                      'text-xs flex items-center justify-end gap-1',
                      isPositive ? 'text-success' : 'text-destructive'
                    )}>
                      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isPositive ? '+' : ''}{sym.changePercent?.toFixed(2)}%
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={(e) => handleAddToWatchlist(sym.symbol, e)}
                    disabled={inWatchlist}
                  >
                    {inWatchlist ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
