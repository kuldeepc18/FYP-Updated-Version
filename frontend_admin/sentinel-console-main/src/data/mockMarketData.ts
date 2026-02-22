// Mock Market Data for Admin Dashboard

export interface MarketInstrument {
  symbol: string;
  name: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  high24h: number;
  low24h: number;
  timestamp: string;
}

export interface OrderBookEntry {
  id: string;
  symbol: string;
  side: "BID" | "ASK";
  price: number;
  quantity: number;
  total: number;
  timestamp: string;
  source: "MARKET" | "MODEL";
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  total: number;
  maker: string;
  taker: string;
  timestamp: string;
  source: "MARKET" | "MODEL";
}

export interface SurveillanceAlert {
  id: string;
  type: "ANOMALY" | "MANIPULATION" | "SUSPICIOUS";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  symbol: string;
  description: string;
  detectedAt: string;
  status: "ACTIVE" | "INVESTIGATING" | "RESOLVED";
}

// Generate timestamps
const now = new Date();
const formatTime = (offset: number) => {
  const date = new Date(now.getTime() - offset * 1000);
  return date.toISOString();
};

export const marketInstruments: MarketInstrument[] = [
  { symbol: "BTC/USD", name: "Bitcoin", lastPrice: 43250.00, change: 1250.50, changePercent: 2.98, volume: 1234567890, high24h: 43800.00, low24h: 41500.00, timestamp: formatTime(5) },
  { symbol: "ETH/USD", name: "Ethereum", lastPrice: 2285.75, change: -45.25, changePercent: -1.94, volume: 567890123, high24h: 2350.00, low24h: 2240.00, timestamp: formatTime(3) },
  { symbol: "XRP/USD", name: "Ripple", lastPrice: 0.6234, change: 0.0156, changePercent: 2.56, volume: 234567890, high24h: 0.6350, low24h: 0.6050, timestamp: formatTime(8) },
  { symbol: "SOL/USD", name: "Solana", lastPrice: 98.45, change: 3.25, changePercent: 3.41, volume: 189234567, high24h: 99.80, low24h: 94.20, timestamp: formatTime(2) },
  { symbol: "ADA/USD", name: "Cardano", lastPrice: 0.5678, change: -0.0234, changePercent: -3.96, volume: 156789012, high24h: 0.5950, low24h: 0.5600, timestamp: formatTime(12) },
  { symbol: "DOGE/USD", name: "Dogecoin", lastPrice: 0.0845, change: 0.0012, changePercent: 1.44, volume: 98765432, high24h: 0.0865, low24h: 0.0820, timestamp: formatTime(7) },
  { symbol: "DOT/USD", name: "Polkadot", lastPrice: 7.234, change: -0.156, changePercent: -2.11, volume: 78901234, high24h: 7.450, low24h: 7.150, timestamp: formatTime(15) },
  { symbol: "AVAX/USD", name: "Avalanche", lastPrice: 35.67, change: 1.23, changePercent: 3.57, volume: 67890123, high24h: 36.20, low24h: 34.00, timestamp: formatTime(4) },
];

export const orderBookData: OrderBookEntry[] = [
  // BTC/USD Bids
  { id: "OB001", symbol: "BTC/USD", side: "BID", price: 43245.00, quantity: 2.5, total: 108112.50, timestamp: formatTime(1), source: "MARKET" },
  { id: "OB002", symbol: "BTC/USD", side: "BID", price: 43240.00, quantity: 1.8, total: 77832.00, timestamp: formatTime(2), source: "MARKET" },
  { id: "OB003", symbol: "BTC/USD", side: "BID", price: 43235.00, quantity: 3.2, total: 138352.00, timestamp: formatTime(3), source: "MODEL" },
  { id: "OB004", symbol: "BTC/USD", side: "BID", price: 43230.00, quantity: 0.75, total: 32422.50, timestamp: formatTime(4), source: "MARKET" },
  { id: "OB005", symbol: "BTC/USD", side: "BID", price: 43225.00, quantity: 4.1, total: 177222.50, timestamp: formatTime(5), source: "MARKET" },
  // BTC/USD Asks
  { id: "OB006", symbol: "BTC/USD", side: "ASK", price: 43255.00, quantity: 1.2, total: 51906.00, timestamp: formatTime(1), source: "MARKET" },
  { id: "OB007", symbol: "BTC/USD", side: "ASK", price: 43260.00, quantity: 2.8, total: 121128.00, timestamp: formatTime(2), source: "MODEL" },
  { id: "OB008", symbol: "BTC/USD", side: "ASK", price: 43265.00, quantity: 0.95, total: 41101.75, timestamp: formatTime(3), source: "MARKET" },
  { id: "OB009", symbol: "BTC/USD", side: "ASK", price: 43270.00, quantity: 3.5, total: 151445.00, timestamp: formatTime(4), source: "MARKET" },
  { id: "OB010", symbol: "BTC/USD", side: "ASK", price: 43275.00, quantity: 1.65, total: 71403.75, timestamp: formatTime(5), source: "MARKET" },
  // ETH/USD entries
  { id: "OB011", symbol: "ETH/USD", side: "BID", price: 2284.50, quantity: 15.5, total: 35409.75, timestamp: formatTime(1), source: "MARKET" },
  { id: "OB012", symbol: "ETH/USD", side: "BID", price: 2284.00, quantity: 22.3, total: 50935.20, timestamp: formatTime(2), source: "MARKET" },
  { id: "OB013", symbol: "ETH/USD", side: "ASK", price: 2286.00, quantity: 18.7, total: 42748.20, timestamp: formatTime(1), source: "MODEL" },
  { id: "OB014", symbol: "ETH/USD", side: "ASK", price: 2286.50, quantity: 12.4, total: 28352.60, timestamp: formatTime(2), source: "MARKET" },
];

export const tradeHistory: TradeRecord[] = [
  { id: "TR001", symbol: "BTC/USD", side: "BUY", price: 43250.00, quantity: 0.5, total: 21625.00, maker: "MM-001", taker: "USR-234", timestamp: formatTime(10), source: "MARKET" },
  { id: "TR002", symbol: "BTC/USD", side: "SELL", price: 43248.50, quantity: 1.2, total: 51898.20, maker: "MM-002", taker: "USR-567", timestamp: formatTime(25), source: "MARKET" },
  { id: "TR003", symbol: "ETH/USD", side: "BUY", price: 2285.75, quantity: 8.5, total: 19428.88, maker: "MM-001", taker: "USR-123", timestamp: formatTime(45), source: "MODEL" },
  { id: "TR004", symbol: "SOL/USD", side: "SELL", price: 98.40, quantity: 150, total: 14760.00, maker: "MM-003", taker: "USR-890", timestamp: formatTime(60), source: "MARKET" },
  { id: "TR005", symbol: "BTC/USD", side: "BUY", price: 43252.00, quantity: 0.25, total: 10813.00, maker: "USR-456", taker: "MM-001", timestamp: formatTime(85), source: "MARKET" },
  { id: "TR006", symbol: "XRP/USD", side: "SELL", price: 0.6230, quantity: 5000, total: 3115.00, maker: "MM-002", taker: "USR-321", timestamp: formatTime(120), source: "MODEL" },
  { id: "TR007", symbol: "ETH/USD", side: "SELL", price: 2284.00, quantity: 12.3, total: 28093.20, maker: "MM-001", taker: "USR-654", timestamp: formatTime(180), source: "MARKET" },
  { id: "TR008", symbol: "AVAX/USD", side: "BUY", price: 35.68, quantity: 280, total: 9990.40, maker: "MM-004", taker: "USR-789", timestamp: formatTime(240), source: "MARKET" },
  { id: "TR009", symbol: "BTC/USD", side: "SELL", price: 43245.00, quantity: 0.75, total: 32433.75, maker: "USR-111", taker: "MM-002", timestamp: formatTime(300), source: "MODEL" },
  { id: "TR010", symbol: "DOT/USD", side: "BUY", price: 7.235, quantity: 420, total: 3038.70, maker: "MM-003", taker: "USR-222", timestamp: formatTime(360), source: "MARKET" },
];

export const surveillanceAlerts: SurveillanceAlert[] = [
  { id: "SA001", type: "ANOMALY", severity: "HIGH", symbol: "BTC/USD", description: "Unusual volume spike detected - 340% above 24h average", detectedAt: formatTime(120), status: "ACTIVE" },
  { id: "SA002", type: "MANIPULATION", severity: "CRITICAL", symbol: "XRP/USD", description: "Potential spoofing pattern identified in order book", detectedAt: formatTime(450), status: "INVESTIGATING" },
  { id: "SA003", type: "SUSPICIOUS", severity: "MEDIUM", symbol: "SOL/USD", description: "Coordinated trading activity from multiple accounts", detectedAt: formatTime(890), status: "ACTIVE" },
  { id: "SA004", type: "ANOMALY", severity: "LOW", symbol: "ETH/USD", description: "Price deviation from reference exchanges exceeds threshold", detectedAt: formatTime(1200), status: "RESOLVED" },
  { id: "SA005", type: "MANIPULATION", severity: "HIGH", symbol: "DOGE/USD", description: "Wash trading indicators detected across 12 accounts", detectedAt: formatTime(1800), status: "INVESTIGATING" },
  { id: "SA006", type: "SUSPICIOUS", severity: "MEDIUM", symbol: "ADA/USD", description: "Layering pattern in order book depth", detectedAt: formatTime(2400), status: "ACTIVE" },
];

export const mlModelStatus = {
  currentModel: "MarketSentinel-v2.4.1",
  status: "TRAINING",
  progress: 67,
  lastTraining: "2024-01-05T14:30:00Z",
  nextScheduled: "2024-01-08T02:00:00Z",
  datasetSize: 15678234,
  accuracy: 94.2,
  precision: 92.8,
  recall: 95.1,
  f1Score: 93.9,
};
