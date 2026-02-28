import { adminApiClient, ADMIN_API_ENDPOINTS } from '@/config/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketInstrument {
  instrument_id    : string;
  instrument_name  : string;
  symbol           : string;
  last_price       : number;
  change           : number;
  change_percent   : number;
  volume_qty       : number;
  high24h          : number;
  low24h           : number;
  latest_timestamp : string;
}

export interface OrderLevel {
  price      : number;
  qty_buyers : number;
}

export interface AskLevel {
  price       : number;
  qty_sellers : number;
}

export interface OrderBookData {
  instrument_id   : string;
  instrument_name : string;
  symbol          : string;
  bids            : OrderLevel[];  // sorted DESC by price
  asks            : AskLevel[];    // sorted ASC  by price
}

// Legacy flat entry kept for backward-compat (used by old /orders/book)
export interface OrderBookEntry {
  id        : string;
  side      : 'BID' | 'ASK';
  price     : number;
  quantity  : number;
  total     : number;
  orderType : string;
  userId    : string;
  status    : string;
  timestamp : string;
}

export interface TradeRecord {
  order_id               : string;
  instrument_id          : string;
  instrument_name        : string;
  side                   : 'BUY' | 'SELL';
  order_type             : string;
  price                  : number;
  quantity               : number;
  filled_quantity        : number;
  remaining_quantity     : number;
  total                  : number;
  status                 : string;
  user_id                : string;
  trade_id               : string;
  buyer_user_id          : string;
  seller_user_id         : string;
  market_phase           : string;
  device_id_hash         : string;
  is_short_sell          : boolean;
  order_submit_timestamp : number;   // microseconds since Unix epoch
  order_cancel_timestamp : number;   // microseconds since Unix epoch (0 = not cancelled)
  timestamp              : string;
}

export interface TradeStats {
  total_trades : number;
  total_volume : number;
  buy_volume   : number;
  sell_volume  : number;
}

export interface SurveillanceAlert {
  id          : string;
  type        : string;
  severity    : 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  symbol      : string;
  description : string;
  detectedAt  : string;
  status      : 'ACTIVE' | 'RESOLVED' | 'INVESTIGATING';
}

// ─── Market data ──────────────────────────────────────────────────────────────

export async function getMarketInstruments(): Promise<MarketInstrument[]> {
  try {
    const { data } = await adminApiClient.get(ADMIN_API_ENDPOINTS.MARKET.SYMBOLS);
    return (data as any[]).map((inst) => ({
      instrument_id    : inst.instrument_id    ?? '',
      instrument_name  : inst.instrument_name  ?? inst.name ?? '',
      symbol           : inst.symbol           ?? '',
      last_price       : inst.last_price       ?? 0,
      change           : inst.change           ?? 0,
      change_percent   : inst.change_percent   ?? 0,
      volume_qty       : inst.volume_qty       ?? 0,
      high24h          : inst.high24h          ?? 0,
      low24h           : inst.low24h           ?? 0,
      latest_timestamp : inst.latest_timestamp ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error('getMarketInstruments failed:', err);
    return [];
  }
}

// ─── Order book (per-instrument) ─────────────────────────────────────────────

export async function getOrderBookForInstrument(instrumentId: string): Promise<OrderBookData | null> {
  try {
    const { data } = await adminApiClient.get(`${ADMIN_API_ENDPOINTS.ORDERS.BOOK}/${instrumentId}`);
    return data as OrderBookData;
  } catch (err) {
    console.error(`getOrderBookForInstrument(${instrumentId}) failed:`, err);
    return null;
  }
}

// Legacy flat fetch kept for any code that still calls getOrderBook()
export async function getOrderBook(): Promise<OrderBookEntry[]> {
  try {
    const { data } = await adminApiClient.get(ADMIN_API_ENDPOINTS.ORDERS.BOOK);
    return (data as any[]).map((e) => ({
      id        : e.id,
      side      : e.side as 'BID' | 'ASK',
      price     : e.price,
      quantity  : e.quantity,
      total     : e.total,
      orderType : e.orderType,
      userId    : e.userId,
      status    : e.status,
      timestamp : e.timestamp,
    }));
  } catch (err) {
    console.error('getOrderBook failed:', err);
    return [];
  }
}

// ─── Trade history ────────────────────────────────────────────────────────────

export interface TradeHistoryParams {
  status?        : string;   // NEW | PARTIAL | FILLED | CANCELLED | EXPIRED
  side?          : string;   // BUY | SELL
  instrument_id? : string;
  limit?         : number;
}

export async function getTradeHistory(params: TradeHistoryParams = {}): Promise<TradeRecord[]> {
  try {
    const { data } = await adminApiClient.get(ADMIN_API_ENDPOINTS.TRADES.HISTORY, { params });
    return (data as any[]).map((r) => ({
      order_id               : r.order_id               ?? r.id ?? '',
      instrument_id          : r.instrument_id          ?? '',
      instrument_name        : r.instrument_name        ?? '',
      side                   : r.side as 'BUY' | 'SELL',
      order_type             : r.order_type             ?? r.orderType ?? '',
      price                  : r.price                  ?? 0,
      quantity               : r.quantity               ?? 0,
      filled_quantity        : r.filled_quantity        ?? r.filledQuantity ?? 0,
      remaining_quantity     : r.remaining_quantity     ?? 0,
      total                  : r.total                  ?? 0,
      status                 : r.status                 ?? '',
      user_id                : r.user_id                ?? r.userId ?? '',
      trade_id               : r.trade_id               ?? 'NA',
      buyer_user_id          : r.buyer_user_id          ?? 'NA',
      seller_user_id         : r.seller_user_id         ?? 'NA',
      market_phase           : r.market_phase           ?? '',
      device_id_hash         : r.device_id_hash         ?? '',
      is_short_sell          : r.is_short_sell          ?? false,
      order_submit_timestamp : r.order_submit_timestamp ?? 0,
      order_cancel_timestamp : r.order_cancel_timestamp ?? 0,
      timestamp              : r.timestamp              ?? '',
    }));
  } catch (err) {
    console.error('getTradeHistory failed:', err);
    return [];
  }
}

// ─── Trade stats ──────────────────────────────────────────────────────────────

export async function getTradeStats(): Promise<TradeStats> {
  try {
    const { data } = await adminApiClient.get(ADMIN_API_ENDPOINTS.TRADES.STATS);
    return data as TradeStats;
  } catch (err) {
    console.error('getTradeStats failed:', err);
    return { total_trades: 0, total_volume: 0, buy_volume: 0, sell_volume: 0 };
  }
}

// ─── Surveillance ─────────────────────────────────────────────────────────────

export async function getSurveillanceAlerts(): Promise<SurveillanceAlert[]> {
  return [];
}

// ─── Backend health check ─────────────────────────────────────────────────────
// Returns true if the admin API is reachable. Used by tabs to show a live /
// offline indicator and freeze updates when the backend is down.
export async function checkBackendHealth(): Promise<boolean> {
  try {
    await adminApiClient.get('/health', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
