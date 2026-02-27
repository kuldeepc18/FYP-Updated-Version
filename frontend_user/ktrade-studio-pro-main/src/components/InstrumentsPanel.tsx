import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Search, Plus, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSelectedSymbol, addToWatchlist } from '@/store/tradingSlice';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export const InstrumentsPanel = () => {
  const navigate    = useNavigate();
  const dispatch    = useAppDispatch();
  const symbols     = useAppSelector((state) => state.trading.symbols);          // live SSE-driven
  const { selectedSymbol, watchlists, activeWatchlist } = useAppSelector((s) => s.trading);
  const [searchQuery, setSearchQuery] = useState('');

  const activeList      = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols = activeList?.symbols || [];

  const filtered = searchQuery
    ? symbols.filter(
        (s) =>
          s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : symbols;

  const handleSymbolClick = (sym: string) => {
    dispatch(setSelectedSymbol(sym));
    navigate(`/trade/${encodeURIComponent(sym)}`);
  };

  const handleAddToWatchlist = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeList && !watchlistSymbols.includes(sym)) {
      dispatch(addToWatchlist({ watchlistId: activeList.id, symbol: sym }));
      toast.success(`${sym} added to watchlist`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b bg-muted/20 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search instruments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">
          {filtered.length} instruments • live
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {symbols.length === 0 ? 'Loading market data…' : 'No results'}
            </p>
          )}
          {filtered.map((sym) => {
            const isSelected  = selectedSymbol === sym.symbol;
            const isPositive  = (sym.changePercent || 0) >= 0;
            const inWatchlist = watchlistSymbols.includes(sym.symbol);

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
                    <span className="font-semibold text-sm truncate">{sym.symbol}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{sym.name}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="font-semibold text-sm">₹{sym.price.toFixed(2)}</div>
                    <div
                      className={cn(
                        'text-xs flex items-center justify-end gap-1',
                        isPositive ? 'text-success' : 'text-destructive'
                      )}
                    >
                      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isPositive ? '+' : ''}
                      {sym.changePercent?.toFixed(2)}%
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => handleAddToWatchlist(sym.symbol, e)}
                    disabled={inWatchlist}
                  >
                    {inWatchlist ? <Check className="w-4 h-4 text-success" /> : <Plus className="w-4 h-4" />}
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
