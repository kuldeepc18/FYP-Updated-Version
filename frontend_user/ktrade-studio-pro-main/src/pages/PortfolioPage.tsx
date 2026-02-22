import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSymbols } from '@/store/tradingSlice';
import { marketDataService } from '@/services';
import { cn } from '@/lib/utils';
import { ArrowRight, TrendingUp, TrendingDown, Wallet, PieChart, BarChart3 } from 'lucide-react';

const PortfolioPage = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { positions, account, symbols } = useAppSelector((state) => state.trading);

  useEffect(() => {
    const loadSymbols = async () => {
      const allSymbols = await marketDataService.getSymbols();
      dispatch(setSymbols(allSymbols));
    };
    loadSymbols();
  }, [dispatch]);

  const totalInvested = positions.reduce((sum, p) => sum + (p.quantity * p.averagePrice), 0);
  const totalCurrent = positions.reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-muted-foreground text-sm">Your holdings and allocation</p>
        </div>
        <Button onClick={() => navigate('/trade')}>
          Trade Now
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">Total Balance</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(account.balance)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-muted">
              <PieChart className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Invested</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(totalInvested)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-muted">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Current Value</span>
          </div>
          <div className="text-2xl font-bold">{formatCurrency(totalCurrent)}</div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2">
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
            <span className="text-sm text-muted-foreground">Total P&L</span>
          </div>
          <div className={cn(
            "text-2xl font-bold",
            totalPnl >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
          </div>
          <div className={cn(
            "text-sm",
            totalPnl >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
          </div>
        </Card>
      </div>

      {/* Holdings */}
      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Holdings ({positions.length})</h2>
        </div>
        {positions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p>No holdings yet</p>
            <p className="text-sm mt-1">Start trading to build your portfolio</p>
            <Button className="mt-4" onClick={() => navigate('/trade')}>
              Start Trading
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {positions.map((position) => {
              const symData = symbols.find((s) => s.symbol === position.symbol);
              const isPositive = position.unrealizedPnl >= 0;

              return (
                <div
                  key={position.symbol}
                  className="p-4 flex items-center justify-between hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/trade/${position.symbol}`)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{position.symbol}</span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded",
                        position.side === 'BUY' ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      )}>
                        {position.side}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{symData?.name}</p>
                  </div>

                  <div className="grid grid-cols-4 gap-8 text-right">
                    <div>
                      <div className="text-xs text-muted-foreground">Qty</div>
                      <div className="font-medium">{position.quantity}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Avg Price</div>
                      <div className="font-medium">₹{position.averagePrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">LTP</div>
                      <div className="font-medium">₹{position.currentPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">P&L</div>
                      <div className={cn(
                        "font-semibold",
                        isPositive ? "text-success" : "text-destructive"
                      )}>
                        {isPositive ? '+' : ''}₹{position.unrealizedPnl.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PortfolioPage;
