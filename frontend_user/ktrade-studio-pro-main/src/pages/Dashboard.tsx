import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, TrendingUp, TrendingDown, Wallet, BarChart3, Target, Activity } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSymbols, setSelectedSymbol } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';

const Dashboard = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { symbols, positions, account, watchlists, activeWatchlist, orders } = useAppSelector(
    (state) => state.trading
  );

  useEffect(() => {
    const loadSymbols = async () => {
      const allSymbols = await marketDataService.getSymbols();
      dispatch(setSymbols(allSymbols));
    };
    loadSymbols();
  }, [dispatch]);

  const activeWatchlistData = watchlists.find((w) => w.id === activeWatchlist);
  const watchlistSymbols = activeWatchlistData?.symbols.slice(0, 5) || [];

  const topGainers = [...symbols]
    .filter((s) => s.changePercent !== undefined)
    .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))
    .slice(0, 5);

  const topLosers = [...symbols]
    .filter((s) => s.changePercent !== undefined)
    .sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0))
    .slice(0, 5);

  const handleSymbolClick = (symbol: string) => {
    dispatch(setSelectedSymbol(symbol));
    navigate(`/trade/${symbol}`);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalPnlPercent = positions.length > 0
    ? (totalPnl / account.balance) * 100
    : 0;

  const pendingOrders = orders.filter(o => o.status === 'OPEN' || o.status === 'PENDING').length;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Welcome to KTrade Studio</p>
        </div>
        <Button onClick={() => navigate('/trade/RELIANCE')} size="lg">
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
          <div className="text-2xl font-bold">{formatCurrency(account.balance)}</div>
        </Card>
        
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-muted">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Available Margin</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(account.availableMargin)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              "p-2 rounded-lg",
              totalPnl >= 0 ? "bg-success/10" : "bg-destructive/10"
            )}>
              {totalPnl >= 0 ? (
                <TrendingUp className="w-5 h-5 text-success" />
              ) : (
                <TrendingDown className="w-5 h-5 text-destructive" />
              )}
            </div>
            <span className="text-sm text-muted-foreground">Unrealized P&L</span>
          </div>
          <div className={cn(
            'text-2xl font-bold',
            totalPnl >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {formatCurrency(totalPnl)}
          </div>
          <div className={cn(
            'text-xs mt-1',
            totalPnl >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-muted">
              <Activity className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Open Positions</span>
          </div>
          <div className="text-2xl font-bold">{positions.length}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {pendingOrders} pending orders
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
                  <div className="text-sm font-semibold mb-1">{symbol.symbol}</div>
                  <div className="text-lg font-bold mb-1">₹{symbol.price.toFixed(2)}</div>
                  <div className={cn(
                    'text-xs flex items-center gap-1',
                    isPositive ? 'text-success' : 'text-destructive'
                  )}>
                    {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isPositive ? '+' : ''}{symbol.changePercent?.toFixed(2)}%
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Market Movers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-success" />
            <h2 className="font-semibold">Top Gainers</h2>
          </div>
          <div className="space-y-2">
            {topGainers.map((symbol) => (
              <div
                key={symbol.symbol}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => handleSymbolClick(symbol.symbol)}
              >
                <div>
                  <div className="font-semibold text-sm">{symbol.symbol}</div>
                  <div className="text-xs text-muted-foreground">{symbol.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">₹{symbol.price.toFixed(2)}</div>
                  <div className="text-success text-xs font-medium">
                    +{symbol.changePercent?.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-destructive" />
            <h2 className="font-semibold">Top Losers</h2>
          </div>
          <div className="space-y-2">
            {topLosers.map((symbol) => (
              <div
                key={symbol.symbol}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => handleSymbolClick(symbol.symbol)}
              >
                <div>
                  <div className="font-semibold text-sm">{symbol.symbol}</div>
                  <div className="text-xs text-muted-foreground">{symbol.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">₹{symbol.price.toFixed(2)}</div>
                  <div className="text-destructive text-xs font-medium">
                    {symbol.changePercent?.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground pt-4">
        <p>© 2025 KTrade Studio — Demo & Educational Use Only</p>
      </div>
    </div>
  );
};

export default Dashboard;
