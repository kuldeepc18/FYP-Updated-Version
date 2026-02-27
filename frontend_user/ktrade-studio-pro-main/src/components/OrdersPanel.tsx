import { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setOrders, cancelOrder, setPositions, setMyTrades } from '@/store/tradingSlice';
import { orderServiceApi } from '@/services/orderServiceApi';
import { cn } from '@/lib/utils';
import { X, ChevronUp, ChevronDown, LogOut, Target } from 'lucide-react';
import { toast } from 'sonner';

interface EditDialog {
  open: boolean;
  symbol: string;
  orderId: string;
  targetPrice: string;
  stopLoss: string;
}

const EMPTY_EDIT: EditDialog = { open: false, symbol: '', orderId: '', targetPrice: '', stopLoss: '' };

export const OrdersPanel = () => {
  const dispatch    = useAppDispatch();
  const { orders, positions, myTrades, symbols } = useAppSelector((s) => s.trading);
  const [isExpanded,    setIsExpanded]    = useState(true);
  const [activeTab,     setActiveTab]     = useState('positions');
  const [editDialog,    setEditDialog]    = useState<EditDialog>(EMPTY_EDIT);
  const [savingEdit,    setSavingEdit]    = useState(false);
  const [exitingAll,    setExitingAll]    = useState(false);
  const [exitingSymbol, setExitingSymbol] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Poll every 3 s ────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [fetchedOrders, fetchedPositions, fetchedMyTrades] = await Promise.all([
        orderServiceApi.getOrders(),
        orderServiceApi.getPositions(),
        orderServiceApi.getMyTrades(),
      ]);
      dispatch(setOrders(fetchedOrders));
      dispatch(setPositions(fetchedPositions));
      dispatch(setMyTrades(fetchedMyTrades));
    } catch { /* silent */ }
  }, [dispatch]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  // ── Live LTP from SSE store ───────────────────────────────────────────────
  const getLTP = (sym: string) => symbols.find((s) => s.symbol === sym)?.price;

  const livePositions = positions.map((pos) => {
    const ltp    = getLTP(pos.symbol) ?? pos.currentPrice;
    const pnl    = pos.side === 'BUY'
      ? (ltp - pos.averagePrice) * pos.quantity
      : (pos.averagePrice - ltp) * pos.quantity;
    const pnlPct = pos.averagePrice > 0 ? (pnl / (pos.averagePrice * pos.quantity)) * 100 : 0;
    return { ...pos, currentPrice: ltp, unrealizedPnl: pnl, unrealizedPnlPercent: pnlPct };
  });

  const pendingOrders = orders.filter((o) => o.status === 'PENDING' || o.status === 'PARTIAL');
  const historyOrders = orders.filter((o) => o.status === 'EXPIRED' || o.status === 'CANCELLED');

  // ── Cancel pending order ──────────────────────────────────────────────────
  const handleCancel = async (orderId: string) => {
    const ok = await orderServiceApi.cancelOrder(orderId);
    if (ok) { dispatch(cancelOrder(orderId)); toast.success('Order cancelled'); fetchAll(); }
    else      toast.error('Failed to cancel order');
  };

  // ── Exit single position ──────────────────────────────────────────────────
  const handleExit = async (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExitingSymbol(symbol);
    try {
      const ok = await orderServiceApi.exitPosition(symbol);
      if (ok) { toast.success(`Exit order placed for ${symbol}`); setTimeout(fetchAll, 800); }
      else      toast.error('Failed to place exit order');
    } finally { setExitingSymbol(null); }
  };

  // ── Exit all positions ────────────────────────────────────────────────────
  const handleExitAll = async () => {
    if (!livePositions.length) return;
    setExitingAll(true);
    try {
      const ok = await orderServiceApi.exitAllPositions();
      if (ok) { toast.success(`Exit orders placed for all ${livePositions.length} positions`); setTimeout(fetchAll, 800); }
      else      toast.error('Failed to place exit orders');
    } finally { setExitingAll(false); }
  };

  // ── Open edit Target/SL dialog ────────────────────────────────────────────
  const handleOpenEdit = (symbol: string) => {
    const filledBuy = orders
      .filter(o => o.symbol === symbol && o.status === 'FILLED' && o.side === 'BUY')
      .sort((a, b) => (b.fillTimestamp || b.timestamp) - (a.fillTimestamp || a.timestamp))[0];
    setEditDialog({
      open       : true,
      symbol,
      orderId    : filledBuy?.id || '',
      targetPrice: filledBuy?.targetPrice != null ? String(filledBuy.targetPrice) : '',
      stopLoss   : filledBuy?.stopLoss    != null ? String(filledBuy.stopLoss)    : '',
    });
  };

  // ── Save Target/SL changes ────────────────────────────────────────────────
  const handleSaveEdit = async () => {
    if (!editDialog.orderId) { toast.error('Could not find the matching order to update.'); return; }
    setSavingEdit(true);
    try {
      const tp = editDialog.targetPrice ? parseFloat(editDialog.targetPrice) : null;
      const sl = editDialog.stopLoss    ? parseFloat(editDialog.stopLoss)    : null;
      const ok = await orderServiceApi.updateOrderTargetSL(editDialog.orderId, tp, sl);
      if (ok) { toast.success('Target & Stop Loss updated'); setEditDialog(EMPTY_EDIT); fetchAll(); }
      else      toast.error('Failed to update Target / Stop Loss');
    } finally { setSavingEdit(false); }
  };

  return (
    <>
      {/* ── Edit Target / Stop Loss dialog ──────────────────────────────── */}
      <Dialog open={editDialog.open} onOpenChange={(v) => !v && setEditDialog(EMPTY_EDIT)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Edit Target &amp; Stop Loss — {editDialog.symbol}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Target Price (₹)</Label>
              <Input
                type="number"
                step="0.05"
                placeholder="Leave blank to remove"
                value={editDialog.targetPrice}
                onChange={(e) => setEditDialog(d => ({ ...d, targetPrice: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Position auto-exits when LTP reaches this price.</p>
            </div>
            <div className="space-y-1">
              <Label>Stop Loss Price (₹)</Label>
              <Input
                type="number"
                step="0.05"
                placeholder="Leave blank to remove"
                value={editDialog.stopLoss}
                onChange={(e) => setEditDialog(d => ({ ...d, stopLoss: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Position auto-exits when LTP falls below this price.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(EMPTY_EDIT)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main panel ──────────────────────────────────────────────────── */}
      <div className={cn('border-t bg-card transition-all', isExpanded ? 'h-60' : 'h-10')}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="flex items-center justify-between border-b bg-muted/30 px-2 shrink-0">
            <TabsList className="bg-transparent h-10 p-0 gap-1">
              <TabsTrigger value="positions" className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Positions ({livePositions.length})
              </TabsTrigger>
              <TabsTrigger value="pending" className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Pending ({pendingOrders.length})
              </TabsTrigger>
              <TabsTrigger value="mytrades" className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                My Trades ({myTrades.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="rounded-sm h-8 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                History ({historyOrders.length})
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-1">
              {activeTab === 'positions' && livePositions.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs px-2 gap-1"
                  disabled={exitingAll}
                  onClick={handleExitAll}
                >
                  <LogOut className="w-3 h-3" />
                  {exitingAll ? 'Exiting…' : 'Exit All'}
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {isExpanded && (
            <>
              {/* ── Positions ───────────────────────────────────────────── */}
              <TabsContent value="positions" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Price</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">LTP</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L %</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {livePositions.length === 0 ? (
                        <tr><td colSpan={7} className="text-center text-muted-foreground py-8 text-sm">No active positions</td></tr>
                      ) : livePositions.map((p) => (
                        <tr
                          key={p.symbol}
                          className="hover:bg-muted/30 cursor-pointer"
                          title="Click row to edit Target & Stop Loss"
                          onClick={() => handleOpenEdit(p.symbol)}
                        >
                          <td className="py-2 px-4">
                            <div className="font-medium">{p.symbol}</div>
                            <div className="text-xs text-muted-foreground">{p.side}</div>
                          </td>
                          <td className="text-right py-2 px-4">
                            <span className={p.side === 'BUY' ? 'text-success' : 'text-destructive'}>
                              {p.side === 'BUY' ? '+' : '-'}{p.quantity}
                            </span>
                          </td>
                          <td className="text-right py-2 px-4">₹{p.averagePrice.toFixed(2)}</td>
                          <td className="text-right py-2 px-4 font-medium">₹{p.currentPrice.toFixed(2)}</td>
                          <td className={cn('text-right py-2 px-4 font-medium', p.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive')}>
                            {p.unrealizedPnl >= 0 ? '+' : ''}₹{p.unrealizedPnl.toFixed(2)}
                          </td>
                          <td className={cn('text-right py-2 px-4', p.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-destructive')}>
                            {p.unrealizedPnlPercent >= 0 ? '+' : ''}{p.unrealizedPnlPercent.toFixed(2)}%
                          </td>
                          <td className="text-right py-2 px-4" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-xs px-2 gap-1"
                              disabled={exitingSymbol === p.symbol}
                              onClick={(e) => handleExit(p.symbol, e)}
                            >
                              <LogOut className="w-3 h-3" />
                              {exitingSymbol === p.symbol ? '…' : 'Exit'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </TabsContent>

              {/* ── Pending ─────────────────────────────────────────────── */}
              <TabsContent value="pending" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Side / Type</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Price</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">LTP</th>
                        <th className="text-center py-2 px-4 font-medium text-muted-foreground">Validity</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pendingOrders.length === 0 ? (
                        <tr><td colSpan={8} className="text-center text-muted-foreground py-8 text-sm">No pending orders</td></tr>
                      ) : pendingOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-muted/30">
                          <td className="py-2 px-4 text-muted-foreground text-xs">{new Date(o.timestamp).toLocaleTimeString()}</td>
                          <td className="py-2 px-4 font-medium">{o.symbol}</td>
                          <td className="py-2 px-4">
                            <span className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</span>
                            <span className="text-muted-foreground ml-1 text-xs">{o.type}</span>
                          </td>
                          <td className="text-right py-2 px-4">{o.quantity}</td>
                          <td className="text-right py-2 px-4">{o.price ? `₹${o.price.toFixed(2)}` : 'Market'}</td>
                          <td className="text-right py-2 px-4 font-medium">
                            {getLTP(o.symbol) != null ? `₹${getLTP(o.symbol)!.toFixed(2)}` : '—'}
                          </td>
                          <td className="text-center py-2 px-4">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', (o as any).validity === 'OVERNIGHT' ? 'bg-blue-500/20 text-blue-400' : 'bg-warning/20 text-warning')}>
                              {(o as any).validity || 'INTRADAY'}
                            </span>
                          </td>
                          <td className="text-right py-2 px-4">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleCancel(o.id)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </TabsContent>

              {/* ── My Trades (squared-off) ──────────────────────────────── */}
              <TabsContent value="mytrades" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Buy</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Sell</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {myTrades.length === 0 ? (
                        <tr><td colSpan={6} className="text-center text-muted-foreground py-8 text-sm">No squared off trades yet</td></tr>
                      ) : myTrades.map((t, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          <td className="py-2 px-4">
                            <div className="font-medium">{t.symbol}</div>
                            <div className="text-xs text-muted-foreground">{new Date(t.timestamp).toLocaleDateString()}</div>
                          </td>
                          <td className="text-right py-2 px-4">{t.quantity}</td>
                          <td className="text-right py-2 px-4">₹{t.averagePrice.toFixed(2)}</td>
                          <td className="text-right py-2 px-4">₹{t.avgSellPrice.toFixed(2)}</td>
                          <td className={cn('text-right py-2 px-4 font-medium', t.pnl >= 0 ? 'text-success' : 'text-destructive')}>
                            {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}
                          </td>
                          <td className={cn('text-right py-2 px-4', t.pnlPercent >= 0 ? 'text-success' : 'text-destructive')}>
                            {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </TabsContent>

              {/* ── History (expired / cancelled) ────────────────────────── */}
              <TabsContent value="history" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Side / Type</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Price</th>
                        <th className="text-center py-2 px-4 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {historyOrders.length === 0 ? (
                        <tr><td colSpan={6} className="text-center text-muted-foreground py-8 text-sm">No expired or cancelled orders</td></tr>
                      ) : historyOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-muted/30">
                          <td className="py-2 px-4 text-muted-foreground text-xs">{new Date(o.timestamp).toLocaleTimeString()}</td>
                          <td className="py-2 px-4 font-medium">{o.symbol}</td>
                          <td className="py-2 px-4">
                            <span className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</span>
                            <span className="text-muted-foreground ml-1 text-xs">{o.type}</span>
                          </td>
                          <td className="text-right py-2 px-4">{o.quantity}</td>
                          <td className="text-right py-2 px-4">{o.price ? `₹${o.price.toFixed(2)}` : 'Market'}</td>
                          <td className="text-center py-2 px-4">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', o.status === 'EXPIRED' ? 'bg-orange-500/20 text-orange-400' : 'bg-muted text-muted-foreground')}>
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </>
  );
};

