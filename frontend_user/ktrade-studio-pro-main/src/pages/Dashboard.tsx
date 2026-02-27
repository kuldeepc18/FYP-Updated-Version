import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, TrendingUp, TrendingDown, Wallet, BarChart3, Activity } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSymbols, setSelectedSymbol, setPositions, updateAccount } from '@/store/tradingSlice';
import { updateUserBalance } from '@/store/authSlice';
import { marketDataService } from '@/services';
import { apiClient } from '@/config/api';
import { Symbol, Position } from '@/types/trading';
import { cn } from '@/lib/utils';

const Dashboard = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { symbols, positions, account, watchlists, activeWatchlist, orders } = useAppSelector(
    (state) => state.trading
  );
  const { user } = useAppSelector((state) => state.auth);

  // Keep a ref to the SSE EventSource so we can clean up on unmount
  const sseRef = useRef<EventSource | null>(null);
  // Interval ref for position polling
  const posIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Fetch user positions from backend ─────────────────────────────────────
  const fetchPositions = useCallback(async () => {
    try {
      const response = await apiClient.get('/user/positions');
      const backendPositions: Position[] = response.data.map((p: any) => ({
        symbol              : p.symbol,
        quantity            : p.quantity,
        averagePrice        : p.averagePrice,
        currentPrice        : p.currentPrice,
        unrealizedPnl       : p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
        side                : p.side,
        timestamp           : p.timestamp,
      }));
      dispatch(setPositions(backendPositions));
    } catch {
      // silently ignore — stale data is fine for a brief interval
    }
  }, [dispatch]);

  // ── Fetch fresh balance from backend and sync to redux + localStorage ──────
  const fetchBalance = useCallback(async () => {
    try {
      const response = await apiClient.get('/auth/me');
      if (response.data?.balance !== undefined) {
        dispatch(updateUserBalance(response.data.balance));
        dispatch(updateAccount({ balance: response.data.balance, availableMargin: response.data.balance }));
      }
    } catch {/* no-op */}
  }, [dispatch]);

  // ── Subscribe to SSE market data stream ───────────────────────────────────
  useEffect(() => {
    // Initial HTTP fetch so we have data immediately
    marketDataService.getSymbols().then(syms => {
      if (syms.length) dispatch(setSymbols(syms));
    });

    // Handler that receives live symbol updates from the SSE stream
    const onUpdate = (syms: Symbol[]) => {
      dispatch(setSymbols(syms));
    };

    marketDataService.onMarketUpdate(onUpdate);
    marketDataService.startRealtimeStream();

    return () => {
      marketDataService.offMarketUpdate(onUpdate);
      // Don't stop the stream — other components may use it. It's a singleton.
    };
  }, [dispatch]);

  // ── Poll positions every 3 s & balance every 10 s ─────────────────────────
  useEffect(() => {
    fetchPositions();
    fetchBalance();

    posIntervalRef.current = setInterval(() => {
      fetchPositions();
    }, 3000);

    // Refresh balance every 10 s to catch fills that affect balance
    const balInterval = setInterval(fetchBalance, 10000);

    return () => {
      if (posIntervalRef.current) clearInterval(posIntervalRef.current);
      clearInterval(balInterval);
    };
  }, [fetchPositions, fetchBalance]);

  // ── Sync auth balance → trading account (so TopNav & Dashboard agree) ─────
  useEffect(() => {
    if (user?.balance !== undefined) {
      dispatch(updateAccount({ balance: user.balance, availableMargin: user.balance }));
    }
  }, [user?.balance, dispatch]);

  const activeWatchlistData = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols    = activeWatchlistData?.symbols.slice(0, 5) || [];

  // Sort by changePercent for top gainers / losers (real-time from SSE)
  const topGainers = [...symbols]
    .filter((s) => (s.changePercent ?? 0) !== 0 || s.price > 0)
    .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))
    .slice(0, 5);

  const topLosers = [...symbols]
    .filter((s) => (s.changePercent ?? 0) !== 0 || s.price > 0)
    .sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0))
    .slice(0, 5);

  const handleSymbolClick = (symbol: string) => {
    dispatch(setSelectedSymbol(symbol));
    navigate(`/trade/${symbol}`);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);

  // Collective unrealized P&L across ALL live running positions
  const totalUnrealizedPnl    = positions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
  const totalInvested         = positions.reduce((sum, p) => sum + p.averagePrice * p.quantity, 0);
  const totalUnrealizedPnlPct = totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0;

  // Display balance: prefer auth store (server-authoritative) over trading slice
  const displayBalance     = user?.balance ?? account.balance;
  const openPositionCount  = positions.length;
  const pendingOrdersCount = orders.filter(o => o.status === 'OPEN' || o.status === 'PENDING').length;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Welcome back, {user?.name || 'Trader'}</p>
        </div>
        <Button onClick={() => navigate('/trade/RELIANCE (NSE)')} size="lg">
          Start Trading
          <ArrowUpRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">Total Balance</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(displayBalance)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-muted">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Available Margin</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(displayBalance)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              'p-2 rounded-lg',
              totalUnrealizedPnl >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
            )}>
              {totalUnrealizedPnl >= 0
                ? <TrendingUp  className="w-5 h-5 text-green-500" />
                : <TrendingDown className="w-5 h-5 text-red-500"  />
              }
            </div>
            <span className="text-sm text-muted-foreground">Unrealized P&L</span>
          </div>
          <div className={cn(
            'text-2xl font-bold',
            totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
          )}>
            {formatCurrency(totalUnrealizedPnl)}
          </div>
          <div className={cn(
            'text-xs mt-1',
            totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'
          )}>
            {totalUnrealizedPnlPct >= 0 ? '+' : ''}{totalUnrealizedPnlPct.toFixed(2)}%
            {positions.length > 0 && ` · ${positions.length} position${positions.length !== 1 ? 's' : ''}`}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-muted">
              <Activity className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Open Positions</span>
          </div>
          <div className="text-2xl font-bold">{openPositionCount}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {pendingOrdersCount} pending orders
          </div>
        </Card>
      </div>

      {/* Quick Watchlist */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Quick Watchlist</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/watchlist')}>
            View All
            <ArrowUpRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {watchlistSymbols.length === 0 ? (
            <div className="col-span-full text-center py-6 text-muted-foreground">
              <p className="text-sm">No symbols in watchlist</p>
              <Button variant="link" size="sm" onClick={() => navigate('/watchlist')}>
                Add symbols
              </Button>
            </div>
          ) : (
            watchlistSymbols.map((symbolName) => {
              const symbol = symbols.find((s) => s.symbol === symbolName);
              if (!symbol) return null;
              const isPositive = (symbol.changePercent || 0) >= 0;
              return (
                <div
                  key={symbol.symbol}
                  className="p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleSymbolClick(symbol.symbol)}
                >
                  <div className="text-sm font-semibold mb-1 truncate" title={symbol.symbol}>
                    {symbol.symbol}
                  </div>
                  <div className="text-lg font-bold mb-1">₹{symbol.price.toFixed(2)}</div>
                  <div className={cn(
                    'text-xs flex items-center gap-1',
                    isPositive ? 'text-green-500' : 'text-red-500'
                  )}>
                    {isPositive
                      ? <TrendingUp  className="w-3 h-3" />
                      : <TrendingDown className="w-3 h-3" />
                    }
                    {isPositive ? '+' : ''}{symbol.changePercent?.toFixed(2)}%
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Market Movers — live from SSE stream */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <h2 className="font-semibold">Top Gainers</h2>
            <span className="text-xs text-muted-foreground ml-auto">Live</span>
          </div>
          <div className="space-y-2">
            {topGainers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading market data…</p>
            ) : topGainers.map((symbol) => (
              <div
                key={symbol.symbol}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => handleSymbolClick(symbol.symbol)}
              >
                <div>
                  <div className="font-semibold text-sm truncate max-w-32" title={symbol.symbol}>
                    {symbol.symbol}
                  </div>
                  <div className="text-xs text-muted-foreground">{symbol.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">₹{symbol.price.toFixed(2)}</div>
                  <div className="text-green-500 text-xs font-medium">
                    +{(symbol.changePercent ?? 0).toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <h2 className="font-semibold">Top Losers</h2>
            <span className="text-xs text-muted-foreground ml-auto">Live</span>
          </div>
          <div className="space-y-2">
            {topLosers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading market data…</p>
            ) : topLosers.map((symbol) => (
              <div
                key={symbol.symbol}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => handleSymbolClick(symbol.symbol)}
              >
                <div>
                  <div className="font-semibold text-sm truncate max-w-32" title={symbol.symbol}>
                    {symbol.symbol}
                  </div>
                  <div className="text-xs text-muted-foreground">{symbol.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">₹{symbol.price.toFixed(2)}</div>
                  <div className="text-red-500 text-xs font-medium">
                    {(symbol.changePercent ?? 0).toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground pt-4">
        <p>© 2026 KTrade Studio — Paper Trading Platform</p>
      </div>
    </div>
  );
};

export default Dashboard;
