import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, X, TrendingUp, TrendingDown, Search } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSelectedSymbol, addToWatchlist, removeFromWatchlist } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Symbol } from '@/types/trading';

export const WatchlistPanel = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { watchlists, activeWatchlist, selectedSymbol, symbols } = useAppSelector(
    (state) => state.trading
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<Symbol[]>([]);

  const activeList = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols = activeList?.symbols || [];

  useEffect(() => {
    const search = async () => {
      if (searchQuery.trim()) {
        const results = await marketDataService.searchSymbols(searchQuery);
        setSearchResults(results.slice(0, 8));
      } else {
        setSearchResults([]);
      }
    };
    search();
  }, [searchQuery]);

  const handleSymbolClick = (symbol: string) => {
    dispatch(setSelectedSymbol(symbol));
    navigate(`/trade/${symbol}`);
  };

  const handleAddSymbol = (symbol: string) => {
    if (activeList) {
      dispatch(addToWatchlist({ watchlistId: activeList.id, symbol }));
      toast.success(`${symbol} added to watchlist`);
      setSearchQuery('');
      setShowSearch(false);
    }
  };

  const handleRemoveSymbol = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeList) {
      dispatch(removeFromWatchlist({ watchlistId: activeList.id, symbol }));
      toast.success(`${symbol} removed from watchlist`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center justify-between bg-muted/20">
        <span className="text-sm font-medium text-muted-foreground">
          {watchlistSymbols.length} symbols
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => setShowSearch(!showSearch)}
        >
          {showSearch ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span className="ml-1">{showSearch ? 'Cancel' : 'Add'}</span>
        </Button>
      </div>

      {showSearch && (
        <div className="p-3 border-b bg-muted/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search to add..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-background"
              autoFocus
            />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 border rounded-md bg-background overflow-hidden">
              {searchResults.map((sym) => (
                <div
                  key={sym.symbol}
                  className="p-2.5 hover:bg-muted cursor-pointer flex justify-between items-center border-b last:border-b-0"
                  onClick={() => handleAddSymbol(sym.symbol)}
                >
                  <div>
                    <div className="font-medium text-sm">{sym.symbol}</div>
                    <div className="text-xs text-muted-foreground">{sym.name}</div>
                  </div>
                  <Plus className="w-4 h-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {watchlistSymbols.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-sm">No symbols in watchlist</p>
              <p className="text-xs mt-1">Click + Add to get started</p>
            </div>
          ) : (
            watchlistSymbols.map((symbol) => {
              const symData = symbols.find((s) => s.symbol === symbol);
              if (!symData) return null;

              const isSelected = selectedSymbol === symbol;
              const isPositive = (symData.changePercent || 0) >= 0;
              const price = symData.price || 0;
              const change = symData.changePercent || 0;

              return (
                <div
                  key={symbol}
                  className={cn(
                    'p-3 cursor-pointer group hover:bg-muted/50 transition-colors flex items-center justify-between',
                    isSelected && 'bg-primary/5 border-l-2 border-l-primary'
                  )}
                  onClick={() => handleSymbolClick(symbol)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{symData.symbol}</div>
                    <p className="text-xs text-muted-foreground truncate">{symData.name}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="font-semibold text-sm">₹{price.toFixed(2)}</div>
                      <div className={cn(
                        'text-xs flex items-center justify-end gap-1',
                        isPositive ? 'text-success' : 'text-destructive'
                      )}>
                        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isPositive ? '+' : ''}{change.toFixed(2)}%
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleRemoveSymbol(symbol, e)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
