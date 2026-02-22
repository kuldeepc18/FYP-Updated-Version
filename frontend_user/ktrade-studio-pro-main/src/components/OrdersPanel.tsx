import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { cancelOrder } from '@/store/tradingSlice';
import { orderService } from '@/services';
import { cn } from '@/lib/utils';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

export const OrdersPanel = () => {
  const dispatch = useAppDispatch();
  const { orders, positions } = useAppSelector((state) => state.trading);
  const [isExpanded, setIsExpanded] = useState(true);

  const activeOrders = orders.filter(o => o.status === 'OPEN' || o.status === 'PENDING');
  const filledOrders = orders.filter(o => o.status === 'FILLED').slice(-20);

  const handleCancelOrder = (orderId: string) => {
    try {
      orderService.cancelOrder(orderId);
      dispatch(cancelOrder(orderId));
      toast.success('Order cancelled');
    } catch (error) {
      toast.error('Failed to cancel order');
    }
  };

  return (
    <div className={cn(
      "border-t bg-card transition-all",
      isExpanded ? "h-56" : "h-10"
    )}>
      <Tabs defaultValue="positions" className="h-full flex flex-col">
        <div className="flex items-center justify-between border-b bg-muted/30 px-2">
          <TabsList className="bg-transparent h-10 p-0 gap-1">
            <TabsTrigger 
              value="positions" 
              className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger 
              value="pending" 
              className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Pending ({activeOrders.length})
            </TabsTrigger>
            <TabsTrigger 
              value="history" 
              className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              History
            </TabsTrigger>
          </TabsList>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>
        </div>

        {isExpanded && (
          <>
            <TabsContent value="positions" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Price</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">LTP</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&L</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&L %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                          No active positions
                        </td>
                      </tr>
                    ) : (
                      positions.map((position) => (
                        <tr key={position.symbol} className="hover:bg-muted/30">
                          <td className="py-2 px-4 font-medium">{position.symbol}</td>
                          <td className="text-right py-2 px-4">
                            <span className={position.side === 'BUY' ? 'text-success' : 'text-destructive'}>
                              {position.side === 'BUY' ? '+' : '-'}{position.quantity}
                            </span>
                          </td>
                          <td className="text-right py-2 px-4">₹{position.averagePrice.toFixed(2)}</td>
                          <td className="text-right py-2 px-4">₹{position.currentPrice.toFixed(2)}</td>
                          <td className={cn(
                            'text-right py-2 px-4 font-medium',
                            position.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive'
                          )}>
                            {position.unrealizedPnl >= 0 ? '+' : ''}₹{position.unrealizedPnl.toFixed(2)}
                          </td>
                          <td className={cn(
                            'text-right py-2 px-4',
                            position.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-destructive'
                          )}>
                            {position.unrealizedPnlPercent >= 0 ? '+' : ''}{position.unrealizedPnlPercent.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="pending" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Type</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Price</th>
                      <th className="text-center py-2 px-4 font-medium text-muted-foreground">Status</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeOrders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                          No pending orders
                        </td>
                      </tr>
                    ) : (
                      activeOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-muted/30">
                          <td className="py-2 px-4 text-muted-foreground text-xs">
                            {new Date(order.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-4 font-medium">{order.symbol}</td>
                          <td className="py-2 px-4">
                            <span className={order.side === 'BUY' ? 'text-success' : 'text-destructive'}>
                              {order.side}
                            </span>
                            <span className="text-muted-foreground ml-1">{order.type}</span>
                          </td>
                          <td className="text-right py-2 px-4">{order.quantity}</td>
                          <td className="text-right py-2 px-4">
                            {order.price ? `₹${order.price.toFixed(2)}` : 'Market'}
                          </td>
                          <td className="text-center py-2 px-4">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning font-medium">
                              {order.status}
                            </span>
                          </td>
                          <td className="text-right py-2 px-4">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleCancelOrder(order.id)}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Type</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Price</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Fees</th>
                      <th className="text-center py-2 px-4 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filledOrders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                          No order history
                        </td>
                      </tr>
                    ) : (
                      filledOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-muted/30">
                          <td className="py-2 px-4 text-muted-foreground text-xs">
                            {order.fillTimestamp ? new Date(order.fillTimestamp).toLocaleTimeString() : '-'}
                          </td>
                          <td className="py-2 px-4 font-medium">{order.symbol}</td>
                          <td className="py-2 px-4">
                            <span className={order.side === 'BUY' ? 'text-success' : 'text-destructive'}>
                              {order.side}
                            </span>
                            <span className="text-muted-foreground ml-1">{order.type}</span>
                          </td>
                          <td className="text-right py-2 px-4">{order.filledQuantity}</td>
                          <td className="text-right py-2 px-4">
                            {order.averagePrice ? `₹${order.averagePrice.toFixed(2)}` : '-'}
                          </td>
                          <td className="text-right py-2 px-4 text-muted-foreground">₹{order.fees.toFixed(2)}</td>
                          <td className="text-center py-2 px-4">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-medium">
                              FILLED
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
};
