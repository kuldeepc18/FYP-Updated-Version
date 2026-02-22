export interface Symbol {
  symbol: string;
  name: string;
  exchange: string;
  lot: number;
  tick: number;
  price: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
}

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DepthLevel {
  price: number;
  quantity: number;
  orders?: number;
}

export interface MarketDepth {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  timestamp: number;
}

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PARTIAL';
export type OrderValidity = 'INTRADAY' | 'OVERNIGHT';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  status: OrderStatus;
  validity: OrderValidity;
  filledQuantity: number;
  averagePrice?: number;
  fees: number;
  timestamp: number;
  fillTimestamp?: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  side: OrderSide;
  timestamp: number;
}

export interface Account {
  balance: number;
  equity: number;
  margin: number;
  availableMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fees: number;
  netPnl: number;
  timestamp: number;
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export type Timeframe = '1s' | '5s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1D' | '1W' | '1M';
export type ChartType = 'line' | 'candles';

export interface ChartSettings {
  timeframe: Timeframe;
  indicators: string[];
  drawings: any[];
}

export interface Tick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
}
