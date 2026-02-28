import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OrderType, OrderSide, OrderValidity } from '@/types/trading';
import { orderServiceApi } from '@/services';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { addOrder } from '@/store/tradingSlice';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown, AlertTriangle, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface TradeModalProps {
  symbol: string;
  open: boolean;
  onClose: () => void;
  defaultSide?: OrderSide;
}

export const TradeModal = ({ symbol, open, onClose, defaultSide = 'BUY' }: TradeModalProps) => {
  const dispatch   = useAppDispatch();
  const symbols    = useAppSelector((s) => s.trading.symbols);
  const account    = useAppSelector((s) => s.trading.account);
  const authUser   = useAppSelector((s) => s.auth.user);

  const [side, setSide]               = useState<OrderSide>(defaultSide);
  const [orderType, setOrderType]     = useState<OrderType>('MARKET');
  const [validity, setValidity]       = useState<OrderValidity>('INTRADAY');
  const [quantity, setQuantity]       = useState('1');
  const [price, setPrice]             = useState('');
  const [stopPrice, setStopPrice]     = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss]       = useState('');
  const [loading, setLoading]         = useState(false);

  // Reset side when defaultSide prop changes (e.g. buy vs sell button)
  useEffect(() => { setSide(defaultSide); }, [defaultSide]);

  // Live price from SSE-driven redux symbols store
  const symData     = symbols.find((s) => s.symbol === symbol);
  const currentPrice = symData?.price || 0;

  const qty          = Math.max(1, parseInt(quantity, 10) || 0);
  const effPrice     = orderType === 'MARKET' ? currentPrice : (parseFloat(price) || currentPrice);
  const orderValue   = qty * effPrice;
  const fees         = orderValue * 0.001;
  const netAmount    = side === 'BUY' ? orderValue + fees : orderValue - fees;

  const displayBalance = authUser?.balance ?? account.availableMargin;

  // ── Real-time circuit breaker warning ─────────────────────────────────────
  // Compute how far the entered limit price deviates from the current LTP.
  // NSE circuit bands: 2 %, 5 %, 10 %, 20 %.  We warn for every band breached.
  const circuitInfo = useMemo(() => {
    if (orderType === 'MARKET' || !price || currentPrice <= 0) return null;
    const limitPrice = parseFloat(price);
    if (!limitPrice || limitPrice <= 0) return null;

    const pctDiff    = ((limitPrice - currentPrice) / currentPrice) * 100;
    const BANDS      = [20, 10, 5, 2] as const;

    for (const band of BANDS) {
      if (pctDiff >= band) {
        return {
          type   : 'UPPER_CIRCUIT' as const,
          band,
          pctDiff,
          limitPrice,
          ltp    : currentPrice,
        };
      }
      if (pctDiff <= -band) {
        return {
          type   : 'LOWER_CIRCUIT' as const,
          band,
          pctDiff,
          limitPrice,
          ltp    : currentPrice,
        };
      }
    }
    return null;
  }, [price, currentPrice, orderType]);

  const handlePlaceOrder = async () => {
    if (qty <= 0) { toast.error('Enter a valid quantity'); return; }
    if (orderType !== 'MARKET' && !price) { toast.error('Price is required for limit orders'); return; }
    if ((orderType === 'STOP' || orderType === 'STOP_LIMIT') && !stopPrice) { toast.error('Stop price is required'); return; }

    setLoading(true);
    try {
      const order = await orderServiceApi.placeOrder({
        symbol,
        side,
        type       : orderType,
        quantity   : qty,
        price      : orderType !== 'MARKET' ? parseFloat(price) : undefined,
        stopPrice  : stopPrice  ? parseFloat(stopPrice)  : undefined,
        targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
        stopLoss   : stopLoss   ? parseFloat(stopLoss)   : undefined,
        validity,
      });
      dispatch(addOrder(order));

      // Show circuit warning as a persistent toast if the API flagged one
      if (order.circuitWarning) {
        toast.warning(order.circuitWarning, { duration: 8000 });
      } else {
        toast.success(`Order placed: ${side} ${qty} ${symbol} @ ${orderType === 'MARKET' ? 'Market' : `₹${price}`}`);
      }

      // Reset form
      setQuantity('1');
      setPrice('');
      setStopPrice('');
      setTargetPrice('');
      setStopLoss('');
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to place order';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {symbol}
              {/* Circuit breaker badge from live market data */}
              {symData?.circuitStatus === 'UPPER_CIRCUIT' && (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/40 dark:text-orange-300">
                  <ArrowUpCircle className="w-3 h-3" /> UC {symData.circuitBand}%
                </span>
              )}
              {symData?.circuitStatus === 'LOWER_CIRCUIT' && (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300">
                  <ArrowDownCircle className="w-3 h-3" /> LC {symData.circuitBand}%
                </span>
              )}
            </span>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">LTP</span>
              <span className="font-bold text-lg">₹{currentPrice.toFixed(2)}</span>
              {symData && (
                <span className={symData.changePercent! >= 0 ? 'text-success text-sm' : 'text-destructive text-sm'}>
                  {symData.changePercent! >= 0 ? '+' : ''}{symData.changePercent?.toFixed(2)}%
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={side} onValueChange={(v) => setSide(v as OrderSide)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="BUY" className="data-[state=active]:bg-success data-[state=active]:text-white">
              <TrendingUp className="w-4 h-4 mr-2" /> BUY
            </TabsTrigger>
            <TabsTrigger value="SELL" className="data-[state=active]:bg-destructive data-[state=active]:text-white">
              <TrendingDown className="w-4 h-4 mr-2" /> SELL
            </TabsTrigger>
          </TabsList>

          <TabsContent value={side} className="space-y-4 mt-4">
            {/* Order Type & Validity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Order Type</Label>
                <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKET">Market</SelectItem>
                    <SelectItem value="LIMIT">Limit</SelectItem>
                    <SelectItem value="STOP">Stop Loss</SelectItem>
                    <SelectItem value="STOP_LIMIT">Stop Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Validity</Label>
                <Select value={validity} onValueChange={(v) => setValidity(v as OrderValidity)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTRADAY">Intraday (expires 3:30 PM IST)</SelectItem>
                    <SelectItem value="OVERNIGHT">Overnight (persists next day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                placeholder="Number of shares"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            {/* Limit / Stop-Limit Price */}
            {orderType !== 'MARKET' && (
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder={`Limit price (LTP: ₹${currentPrice.toFixed(2)})`}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />

                {/* Real-time circuit breaker warning shown while user types */}
                {circuitInfo && (
                  <Alert
                    className={
                      circuitInfo.type === 'UPPER_CIRCUIT'
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
                        : 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
                    }
                  >
                    {circuitInfo.type === 'UPPER_CIRCUIT'
                      ? <ArrowUpCircle className="h-4 w-4 text-orange-500" />
                      : <ArrowDownCircle className="h-4 w-4 text-blue-500" />}
                    <AlertDescription className="text-xs leading-snug ml-6 -mt-4">
                      <span className={circuitInfo.type === 'UPPER_CIRCUIT' ? 'font-bold text-orange-600' : 'font-bold text-blue-600'}>
                        {circuitInfo.type === 'UPPER_CIRCUIT' ? '⬆ UPPER CIRCUIT' : '⬇ LOWER CIRCUIT'} ({circuitInfo.band}% band)
                      </span>
                      {' '}— Your limit price ₹{circuitInfo.limitPrice.toFixed(2)} is{' '}
                      <strong>{Math.abs(circuitInfo.pctDiff).toFixed(1)}%</strong>{' '}
                      {circuitInfo.type === 'UPPER_CIRCUIT' ? 'above' : 'below'} the current LTP ₹{circuitInfo.ltp.toFixed(2)}.
                      <br />
                      This order will stay <strong>PENDING</strong> until the market gradually moves to your price.
                      {validity === 'INTRADAY'
                        ? ' As an INTRADAY order it will expire at 3:30 PM IST if not filled.'
                        : ' As an OVERNIGHT order it will persist until filled or manually cancelled.'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Stop Price */}
            {(orderType === 'STOP' || orderType === 'STOP_LIMIT') && (
              <div className="space-y-2">
                <Label>Stop Trigger Price</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="Trigger price"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                />
              </div>
            )}

            {/* Target & Stop Loss */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-success">Target Price <span className="text-muted-foreground font-normal text-xs">(auto square-off)</span></Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder={`e.g. ₹${(currentPrice * (side === 'BUY' ? 1.05 : 0.95)).toFixed(0)}`}
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-destructive">Stop Loss <span className="text-muted-foreground font-normal text-xs">(auto square-off)</span></Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder={`e.g. ₹${(currentPrice * (side === 'BUY' ? 0.97 : 1.03)).toFixed(0)}`}
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-muted rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Qty × Price:</span>
                <span className="font-medium">{qty} × ₹{effPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order Value:</span>
                <span className="font-medium">₹{orderValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Brokerage (0.1%):</span>
                <span className="font-medium">₹{fees.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold pt-2 border-t text-base">
                <span>Net Amount:</span>
                <span className={side === 'BUY' ? 'text-destructive' : 'text-success'}>
                  {side === 'BUY' ? '-' : '+'}₹{netAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>Available Balance:</span>
                <span>₹{displayBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={loading || currentPrice === 0}
              variant={side === 'BUY' ? 'default' : 'destructive'}
              onClick={handlePlaceOrder}
              style={side === 'BUY' ? { backgroundColor: 'hsl(var(--success))', color: '#fff' } : undefined}
            >
              {loading ? 'Placing Order…' : `${side} ${qty} ${symbol} @ ${orderType === 'MARKET' ? 'Market' : `₹${price || '—'}`}`}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
