import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, X, TrendingUp, TrendingDown, Search, ArrowRight } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSelectedSymbol, setSymbols, addToWatchlist, removeFromWatchlist } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Symbol } from '@/types/trading';

const WatchlistPage = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { watchlists, activeWatchlist, symbols } = useAppSelector((state) => state.trading);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Symbol[]>([]);

  useEffect(() => {
    const loadSymbols = async () => {
      const allSymbols = await marketDataService.getSymbols();
      dispatch(setSymbols(allSymbols));
    };
    loadSymbols();
  }, [dispatch]);

  useEffect(() => {
    const search = async () => {
      if (searchQuery.trim()) {
        const results = await marketDataService.searchSymbols(searchQuery);
        const activeList = watchlists.find((w) => w.id === activeWatchlist);
        const watchlistSymbols = activeList?.symbols || [];
        setSearchResults(
          results.filter(s => !watchlistSymbols.includes(s.symbol)).slice(0, 8)
        );
      } else {
        setSearchResults([]);
      }
    };
    search();
  }, [searchQuery, watchlists, activeWatchlist]);

  const activeList = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols = activeList?.symbols || [];

  const handleSymbolClick = (symbol: string) => {
    dispatch(setSelectedSymbol(symbol));
    navigate(`/trade/${symbol}`);
  };

  const handleAddSymbol = (symbol: string) => {
    if (activeList) {
      dispatch(addToWatchlist({ watchlistId: activeList.id, symbol }));
      toast.success(`${symbol} added to watchlist`);
      setSearchQuery('');
    }
  };

  const handleRemoveSymbol = (symbol: string) => {
    if (activeList) {
      dispatch(removeFromWatchlist({ watchlistId: activeList.id, symbol }));
      toast.success(`${symbol} removed from watchlist`);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Watchlist</h1>
          <p className="text-muted-foreground text-sm">Manage your tracked instruments</p>
        </div>
        <Button onClick={() => navigate('/trade')}>
          Go to Trading
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Search to add */}
      <Card className="p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search instruments to add..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="mt-3 border rounded-lg divide-y">
            {searchResults.map((sym) => (
              <div
                key={sym.symbol}
                className="p-3 flex items-center justify-between hover:bg-muted/50 cursor-pointer"
                onClick={() => handleAddSymbol(sym.symbol)}
              >
                <div>
                  <div className="font-medium">{sym.symbol}</div>
                  <div className="text-sm text-muted-foreground">{sym.name}</div>
                </div>
                <Button variant="ghost" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Watchlist Items */}
      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">My Watchlist ({watchlistSymbols.length})</h2>
        </div>
        <ScrollArea className="max-h-[500px]">
          <div className="divide-y">
            {watchlistSymbols.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>Your watchlist is empty</p>
                <p className="text-sm mt-1">Search above to add instruments</p>
              </div>
            ) : (
              watchlistSymbols.map((symbol) => {
                const symData = symbols.find((s) => s.symbol === symbol);
                if (!symData) return null;

                const isPositive = (symData.changePercent || 0) >= 0;
                const price = symData.price || 0;
                const change = symData.changePercent || 0;

                return (
                  <div
                    key={symbol}
                    className="p-4 flex items-center justify-between hover:bg-muted/30 cursor-pointer group"
                    onClick={() => handleSymbolClick(symbol)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{symData.symbol}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{symData.exchange || 'NSE'}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{symData.name}</p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold">₹{price.toFixed(2)}</div>
                        <div className={cn(
                          'text-sm flex items-center justify-end gap-1',
                          isPositive ? 'text-success' : 'text-destructive'
                        )}>
                          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isPositive ? '+' : ''}{change.toFixed(2)}%
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSymbol(symbol);
                        }}
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
      </Card>
    </div>
  );
};

export default WatchlistPage;
