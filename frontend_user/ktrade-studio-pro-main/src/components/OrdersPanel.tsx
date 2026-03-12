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
import { X, ChevronUp, ChevronDown, LogOut, Target, ArrowUpCircle, ArrowDownCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api')
  .replace(/\/api$/, '');

interface EditDialog {
  open: boolean;
  symbol: string;
  targetPrice: string;
  stopLoss: string;
}

const EMPTY_EDIT: EditDialog = { open: false, symbol: '', targetPrice: '', stopLoss: '' };

// ── Countdown helper ─────────────────────────────────────────────────────
// Returns { label, urgency } for a pending non-MARKET limit order.
//   urgency: 'normal' | 'warning' | 'critical'
function computeCountdown(
  expiresAt: number | null | undefined,
  validity: string | undefined,
  orderType: string | undefined,
): { label: string; urgency: 'normal' | 'warning' | 'critical' } | null {
  // Only non-MARKET orders have a timer
  if (!expiresAt || orderType === 'MARKET') return null;

  const remaining = expiresAt - Date.now(); // ms remaining

  if (remaining <= 0) return { label: 'Expiring…', urgency: 'critical' };

  if (validity === 'OVERNIGHT') {
    // Show HH:MM:SS for overnight orders
    const totalSec = Math.floor(remaining / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const urgency = h < 1 ? 'warning' : 'normal';
    return { label, urgency };
  } else {
    // INTRADAY — 120-second window; show MM:SS
    const totalSec = Math.floor(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const label = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const urgency = totalSec <= 10 ? 'critical' : totalSec <= 30 ? 'warning' : 'normal';
    return { label, urgency };
  }
}

export const OrdersPanel = () => {
  const dispatch    = useAppDispatch();
  const { orders, positions, myTrades, symbols } = useAppSelector((s) => s.trading);
  const [isExpanded,    setIsExpanded]    = useState(true);
  const [activeTab,     setActiveTab]     = useState('positions');
  const [editDialog,    setEditDialog]    = useState<EditDialog>(EMPTY_EDIT);
  const [savingEdit,    setSavingEdit]    = useState(false);
  const [exitingAll,    setExitingAll]    = useState(false);
  const [exitingSymbol, setExitingSymbol] = useState<string | null>(null);
  // Tick every second to drive real-time countdown for pending limit orders
  const [tick, setTick] = useState(0);
  const sseRef      = useRef<EventSource | null>(null);
  const pollRef     = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── HTTP fallback fetch (used when SSE is unavailable) ───────────────────
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

  // ── SSE-based real-time order/position stream ─────────────────────────────
  // Opens /api/user/orders/stream which pushes { orders, positions } every 2 s.
  // Falls back to 3-second HTTP polling if SSE fails or token is missing.
  useEffect(() => {
    let closed = false;

    function openSSE() {
      if (closed) return;
      const authRaw = localStorage.getItem('ktrade_auth');
      if (!authRaw) { startPolling(); return; }
      let token = '';
      try { token = JSON.parse(authRaw).token || ''; } catch { startPolling(); return; }
      if (!token) { startPolling(); return; }

      const url = `${API_BASE}/api/user/orders/stream?token=${encodeURIComponent(token)}`;
      const es  = new EventSource(url);
      sseRef.current = es;

      es.onmessage = (event) => {
        if (closed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.orders) {
            const orders = (data.orders as any[]).map(d => ({
              id            : d.id,
              symbol        : d.symbol,
              name          : d.name,
              side          : d.side,
              type          : d.orderType || d.type,
              orderType     : d.orderType || d.type,
              quantity      : d.quantity,
              price         : d.price,
              stopPrice     : d.stopPrice,
              targetPrice   : d.targetPrice,
              stopLoss      : d.stopLoss,
              filledQuantity: d.filledQuantity || 0,
              averagePrice  : d.averagePrice,
              status        : d.status,
              validity      : d.validity,
              fees          : d.fees || 0,
              timestamp     : d.timestamp,
              fillTimestamp : d.fillTimestamp,
              cancelledAt   : d.cancelledAt,
              expiredAt     : d.expiredAt,
              isAutoOrder   : d.isAutoOrder,
              autoReason    : d.autoReason,
              expiresAt     : d.expiresAt,
              ltp           : d.ltp,
            }));
            dispatch(setOrders(orders));
          }
          if (data.positions) {
            const positions = (data.positions as any[]).map(p => ({
              symbol              : p.symbol,
              quantity            : p.quantity,
              averagePrice        : p.averagePrice,
              currentPrice        : p.currentPrice || p.averagePrice,
              unrealizedPnl       : p.unrealizedPnl || 0,
              unrealizedPnlPercent: p.unrealizedPnlPercent || 0,
              side                : p.side || 'BUY',
              timestamp           : p.timestamp || Date.now(),
              targetPrice         : p.targetPrice ?? null,
              stopLoss            : p.stopLoss    ?? null,
            }));
            dispatch(setPositions(positions));
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es.close();
        sseRef.current = null;
        if (!closed) {
          // SSE failed — fall back to HTTP polling
          startPolling();
        }
      };
    }

    function startPolling() {
      if (closed || pollRef.current) return;
      fetchAll();
      pollRef.current = setInterval(fetchAll, 3000);
    }

    // Initial HTTP fetch for immediate data, then open SSE
    fetchAll().then(() => {
      // Also fetch myTrades separately (SSE only pushes orders+positions)
      orderServiceApi.getMyTrades().then(trades => dispatch(setMyTrades(trades))).catch(() => {});
    });
    openSSE();

    // Refresh myTrades every 5 s regardless of SSE state
    const myTradesInterval = setInterval(() => {
      orderServiceApi.getMyTrades().then(trades => dispatch(setMyTrades(trades))).catch(() => {});
    }, 5000);

    return () => {
      closed = true;
      sseRef.current?.close();
      sseRef.current = null;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      clearInterval(myTradesInterval);
    };
  }, [dispatch, fetchAll]);

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
  // History shows ALL completed orders: FILLED, CANCELLED, EXPIRED
  const historyOrders = orders.filter((o) =>
    o.status === 'FILLED' || o.status === 'CANCELLED' || o.status === 'EXPIRED'
  );

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
    // Read the currently-active T/SL straight from the enriched position object.
    // The position is already enriched by the backend using the same FIFO logic
    // as the matching loop, so what we pre-fill into the dialog is exactly what
    // is being monitored for auto square-off — no mismatch possible.
    const pos = positions.find(p => p.symbol === symbol);
    setEditDialog({
      open       : true,
      symbol,
      targetPrice: pos?.targetPrice != null ? String(pos.targetPrice) : '',
      stopLoss   : pos?.stopLoss    != null ? String(pos.stopLoss)    : '',
    });
  };

  // ── Save Target/SL changes ────────────────────────────────────────────────
  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      const tp = editDialog.targetPrice ? parseFloat(editDialog.targetPrice) : null;
      const sl = editDialog.stopLoss    ? parseFloat(editDialog.stopLoss)    : null;
      // Use the position-level endpoint so the backend resolves the correct
      // FIFO-open order — guarantees the T/SL is set on the same order that
      // the matching loop monitors for auto square-off.
      const ok = await orderServiceApi.updatePositionTargetSL(editDialog.symbol, tp, sl);
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
                        <th className="text-right py-2 px-4 font-medium text-success/80">Target</th>
                        <th className="text-right py-2 px-4 font-medium text-destructive/80">Stop Loss</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">P&amp;L %</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {livePositions.length === 0 ? (
                        <tr><td colSpan={9} className="text-center text-muted-foreground py-8 text-sm">No active positions</td></tr>
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
                          <td className="text-right py-2 px-4">
                            {p.targetPrice != null
                              ? <span className="text-success font-medium text-xs">₹{Number(p.targetPrice).toFixed(2)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="text-right py-2 px-4">
                            {p.stopLoss != null
                              ? <span className="text-destructive font-medium text-xs">₹{Number(p.stopLoss).toFixed(2)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
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
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty (Filled)</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Price</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Fill</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">LTP</th>
                        <th className="text-center py-2 px-4 font-medium text-muted-foreground">Validity</th>
                        <th className="text-center py-2 px-4 font-medium text-muted-foreground">Expires In</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pendingOrders.length === 0 ? (
                        <tr><td colSpan={10} className="text-center text-muted-foreground py-8 text-sm">No pending orders</td></tr>
                      ) : pendingOrders.map((o) => {

                        const ltp          = getLTP(o.symbol);
                        const limitPrice   = o.price;
                        // For STOP/STOP_LIMIT: the trigger price is stopPrice, not the limit price
                        const stopPrice    = o.stopPrice;
                        // Reference price for circuit-deviation calculation:
                        // LIMIT/STOP_LIMIT → limit price; STOP (market stop) → stop trigger price
                        const refPrice     = limitPrice ?? stopPrice ?? null;
                        // Circuit deviation of the ORDER's limit price vs current LTP
                        const pctDiff      = (ltp && refPrice && ltp > 0)
                          ? ((refPrice - ltp) / ltp) * 100
                          : null;
                        const isUpperCirc  = pctDiff !== null && pctDiff  >=  20;
                        const isLowerCirc  = pctDiff !== null && pctDiff  <= -20;
                        const isModCirc    = !isUpperCirc && !isLowerCirc && pctDiff !== null && Math.abs(pctDiff) >= 5;
                        const symInfo      = symbols.find(s => s.symbol === o.symbol);
                        const symInUC      = symInfo?.circuitStatus === 'UPPER_CIRCUIT';
                        const symInLC      = symInfo?.circuitStatus === 'LOWER_CIRCUIT';

                        // Countdown for non-MARKET pending limit orders (uses tick to re-render)
                        void tick; // reference tick to re-render every second
                        const countdown = computeCountdown(
                          o.expiresAt,
                          (o as any).validity,
                          o.type,
                        );

                        return (
                        <tr key={o.id} className={cn(
                          'hover:bg-muted/30',
                          (isUpperCirc || symInUC) && 'bg-orange-50/30 dark:bg-orange-950/10',
                          (isLowerCirc || symInLC) && 'bg-blue-50/30 dark:bg-blue-950/10',
                        )}>
                          <td className="py-2 px-4 text-muted-foreground text-xs">{new Date(o.timestamp).toLocaleTimeString()}</td>
                          <td className="py-2 px-4 font-medium">
                            <div className="flex items-center gap-1">
                              {o.symbol}
                              {(symInUC || isUpperCirc) && (
                                <span title="Upper Circuit — order price is ≥20% above LTP"
                                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/40 dark:text-orange-300">
                                  <ArrowUpCircle className="w-2.5 h-2.5" /> UC
                                </span>
                              )}
                              {(symInLC || isLowerCirc) && (
                                <span title="Lower Circuit — order price is ≥20% below LTP"
                                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300">
                                  <ArrowDownCircle className="w-2.5 h-2.5" /> LC
                                </span>
                              )}
                              {isModCirc && !isUpperCirc && !isLowerCirc && (
                                <span title={`Order price is ${pctDiff!.toFixed(1)}% from LTP — may take time to fill`}
                                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold bg-yellow-100 text-yellow-700 border border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-300">
                                  ±{Math.abs(pctDiff!).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</span>
                              <span className="text-muted-foreground text-xs">{o.type}</span>
                              {o.status === 'PARTIAL' && (
                                <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300">
                                  PARTIAL
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="text-right py-2 px-4">
                            {o.status === 'PARTIAL' && o.filledQuantity > 0 ? (
                              <div>
                                <span className="text-blue-500 font-medium">{o.filledQuantity}</span>
                                <span className="text-muted-foreground">/{o.quantity}</span>
                              </div>
                            ) : (
                              o.quantity
                            )}
                          </td>
                          <td className="text-right py-2 px-4">
                            {/* For STOP/STOP_LIMIT show both the trigger and limit price */}
                            {(o.type === 'STOP' || o.type === 'STOP_LIMIT') && stopPrice != null ? (
                              <div>
                                <div className="text-xs text-muted-foreground">Trigger</div>
                                <div>₹{stopPrice.toFixed(2)}</div>
                                {o.type === 'STOP_LIMIT' && o.price != null && (
                                  <>
                                    <div className="text-xs text-muted-foreground mt-0.5">Limit</div>
                                    <div>₹{o.price.toFixed(2)}</div>
                                  </>
                                )}
                              </div>
                            ) : (
                              o.price != null ? `₹${o.price.toFixed(2)}` : 'Market'
                            )}
                          </td>
                          <td className="text-right py-2 px-4">
                            {o.status === 'PARTIAL' && o.averagePrice != null ? (
                              <span className="text-blue-500 font-medium">₹{o.averagePrice.toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="text-right py-2 px-4 font-medium">
                            {ltp != null ? `₹${ltp.toFixed(2)}` : '—'}
                            {pctDiff !== null && (
                              <div className={cn(
                                'text-[10px]',
                                pctDiff > 0 ? 'text-orange-500' : 'text-blue-500',
                                Math.abs(pctDiff) < 5 && 'text-muted-foreground',
                              )}>
                                {pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(1)}% away
                              </div>
                            )}
                          </td>
                          <td className="text-center py-2 px-4">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', (o as any).validity === 'OVERNIGHT' ? 'bg-blue-500/20 text-blue-400' : 'bg-warning/20 text-warning')}>
                              {(o as any).validity || 'INTRADAY'}
                            </span>
                          </td>
                          <td className="text-center py-2 px-4">
                            {countdown ? (
                              <span className={cn(
                                'inline-flex items-center gap-1 text-xs font-mono font-medium',
                                countdown.urgency === 'critical' && 'text-destructive animate-pulse',
                                countdown.urgency === 'warning'  && 'text-orange-400',
                                countdown.urgency === 'normal'   && 'text-muted-foreground',
                              )}>
                                <Clock className="w-3 h-3" />
                                {countdown.label}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="text-right py-2 px-4">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleCancel(o.id)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
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

              {/* ── History (filled / expired / cancelled) ───────────────── */}
              <TabsContent value="history" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Instrument</th>
                        <th className="text-left py-2 px-4 font-medium text-muted-foreground">Side / Type</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Qty Filled</th>
                        <th className="text-right py-2 px-4 font-medium text-muted-foreground">Exec. Price</th>
                        <th className="text-center py-2 px-4 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {historyOrders.length === 0 ? (
                        <tr><td colSpan={6} className="text-center text-muted-foreground py-8 text-sm">No order history</td></tr>
                      ) : historyOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-muted/30">
                          <td className="py-2 px-4 text-muted-foreground text-xs">
                            {new Date(
                              o.status === 'FILLED'    ? (o.fillTimestamp  || o.timestamp) :
                              o.status === 'CANCELLED' ? ((o as any).cancelledAt || o.timestamp) :
                              o.status === 'EXPIRED'   ? ((o as any).expiredAt   || o.timestamp) : o.timestamp
                            ).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-4 font-medium">{o.symbol}</td>
                          <td className="py-2 px-4">
                            <span className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</span>
                            <span className="text-muted-foreground ml-1 text-xs">{o.type}</span>
                          </td>
                          <td className="text-right py-2 px-4">
                            {/* For FILLED orders: show filled qty / total ordered */}
                            {o.status === 'FILLED' ? (
                              <span>
                                {(o.filledQuantity > 0 && o.filledQuantity < o.quantity)
                                  ? <><span className="text-warning">{o.filledQuantity}</span><span className="text-muted-foreground">/{o.quantity}</span></>
                                  : o.filledQuantity || o.quantity}
                              </span>
                            ) : (
                              o.quantity
                            )}
                          </td>
                          <td className="text-right py-2 px-4">
                            {/* For FILLED orders: always show the actual execution avg price */}
                            {o.status === 'FILLED'
                              ? (o.averagePrice != null
                                  ? `₹${o.averagePrice.toFixed(2)}`
                                  : o.price != null ? `₹${o.price.toFixed(2)}` : '—')
                              : o.price != null ? `₹${o.price.toFixed(2)}` : 'Market'}
                          </td>
                          <td className="text-center py-2 px-4">
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium',
                              o.status === 'FILLED'    ? 'bg-success/20 text-success' :
                              o.status === 'EXPIRED'   ? 'bg-orange-500/20 text-orange-400' :
                              'bg-muted text-muted-foreground'
                            )}>
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

