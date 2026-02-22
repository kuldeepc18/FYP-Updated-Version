import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { OrderType, OrderSide, OrderValidity } from '@/types/trading';
import { orderService, marketDataService } from '@/services';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { addOrder } from '@/store/tradingSlice';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface TradeModalProps {
  symbol: string;
  open: boolean;
  onClose: () => void;
  defaultSide?: OrderSide;
}

export const TradeModal = ({ symbol, open, onClose, defaultSide = 'BUY' }: TradeModalProps) => {
  const dispatch = useAppDispatch();
  const account = useAppSelector((state) => state.trading.account);
  
  const [side, setSide] = useState<OrderSide>(defaultSide);
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [validity, setValidity] = useState<OrderValidity>('INTRADAY');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [autoQuantity, setAutoQuantity] = useState(false);
  const [autoPercent, setAutoPercent] = useState('10');

  const symbolData = marketDataService.getSymbol(symbol);
  const currentPrice = symbolData?.price || 0;

  const calculateQuantity = () => {
    if (!autoQuantity || !autoPercent) return parseInt(quantity) || 0;
    const percent = parseFloat(autoPercent) / 100;
    const availableAmount = account.availableMargin * percent;
    return Math.floor(availableAmount / currentPrice);
  };

  const effectiveQuantity = autoQuantity ? calculateQuantity() : parseInt(quantity) || 0;
  const effectivePrice = orderType === 'MARKET' ? currentPrice : parseFloat(price) || currentPrice;
  const totalValue = effectiveQuantity * effectivePrice;
  const estimatedFees = totalValue * 0.001; // 0.1% simplified
  const netAmount = totalValue + estimatedFees;

  const handlePlaceOrder = () => {
    if (effectiveQuantity <= 0) {
      toast.error('Invalid quantity');
      return;
    }

    if (orderType !== 'MARKET' && !price) {
      toast.error('Price is required for limit orders');
      return;
    }

    try {
      const order = orderService.placeOrder({
        symbol,
        side,
        type: orderType,
        quantity: effectiveQuantity,
        price: orderType === 'MARKET' ? undefined : parseFloat(price),
        stopPrice: stopPrice ? parseFloat(stopPrice) : undefined,
        targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
        stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
        validity,
      });

      dispatch(addOrder(order));
      toast.success(`Order placed: ${side} ${effectiveQuantity} ${symbol}`);
      onClose();
    } catch (error) {
      toast.error('Failed to place order');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{symbol}</span>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">LTP:</span>
              <span className="font-bold text-lg">₹{currentPrice.toFixed(2)}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={side} onValueChange={(v) => setSide(v as OrderSide)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="BUY" className="data-[state=active]:bg-success data-[state=active]:text-success-foreground">
              <TrendingUp className="w-4 h-4 mr-2" />
              BUY
            </TabsTrigger>
            <TabsTrigger value="SELL" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
              <TrendingDown className="w-4 h-4 mr-2" />
              SELL
            </TabsTrigger>
          </TabsList>

          <TabsContent value={side} className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Order Type</Label>
                <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTRADAY">Intraday</SelectItem>
                    <SelectItem value="OVERNIGHT">Overnight</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Quantity</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="auto-qty" className="text-xs text-muted-foreground">
                    Auto Calculate
                  </Label>
                  <Switch
                    id="auto-qty"
                    checked={autoQuantity}
                    onCheckedChange={setAutoQuantity}
                  />
                </div>
              </div>
              
              {autoQuantity ? (
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Percent"
                    value={autoPercent}
                    onChange={(e) => setAutoPercent(e.target.value)}
                    className="flex-1"
                  />
                  <span className="flex items-center text-sm text-muted-foreground">
                    = {calculateQuantity()} shares
                  </span>
                </div>
              ) : (
                <Input
                  type="number"
                  placeholder="Quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              )}
            </div>

            {orderType !== 'MARKET' && (
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder={`Price (Current: ₹${currentPrice.toFixed(2)})`}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            )}

            {(orderType === 'STOP' || orderType === 'STOP_LIMIT') && (
              <div className="space-y-2">
                <Label>Stop Price</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="Trigger Price"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target Price (Optional)</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="Target"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Stop Loss (Optional)</Label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="Stop Loss"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>
            </div>

            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quantity:</span>
                <span className="font-medium">{effectiveQuantity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price:</span>
                <span className="font-medium">₹{effectivePrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Order Value:</span>
                <span className="font-medium">₹{totalValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Est. Fees:</span>
                <span className="font-medium">₹{estimatedFees.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-bold pt-2 border-t">
                <span>Net Amount:</span>
                <span>₹{netAmount.toFixed(2)}</span>
              </div>
            </div>

            <Button
              className="w-full"
              variant={side === 'BUY' ? 'default' : 'destructive'}
              size="lg"
              onClick={handlePlaceOrder}
            >
              {side} {effectiveQuantity} {symbol} @ ₹{effectivePrice.toFixed(2)}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
