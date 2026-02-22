import { Symbol, OHLCV, MarketDepth, DepthLevel } from '@/types/trading';

// Seed symbols with realistic Indian stock data
const SYMBOLS: Symbol[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 2484.50, open: 2475.00, high: 2495.80, low: 2470.30, volume: 12500000, change: 9.50, changePercent: 0.38 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', lot: 1, tick: 0.05, price: 3825.75, open: 3810.00, high: 3835.90, low: 3805.20, volume: 8200000, change: 15.75, changePercent: 0.41 },
  { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', lot: 1, tick: 0.05, price: 1652.30, open: 1648.50, high: 1658.75, low: 1645.00, volume: 15600000, change: 3.80, changePercent: 0.23 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 1598.90, open: 1592.00, high: 1603.50, low: 1589.75, volume: 9800000, change: 6.90, changePercent: 0.43 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 1089.45, open: 1085.50, high: 1092.80, low: 1083.20, volume: 11200000, change: 3.95, changePercent: 0.36 },
  { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', lot: 1, tick: 0.05, price: 782.60, open: 778.90, high: 785.40, low: 776.30, volume: 18500000, change: 3.70, changePercent: 0.47 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 1563.20, open: 1558.75, high: 1567.90, low: 1555.40, volume: 7400000, change: 4.45, changePercent: 0.29 },
  { symbol: 'ITC', name: 'ITC Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 468.30, open: 466.50, high: 470.85, low: 465.20, volume: 22000000, change: 1.80, changePercent: 0.39 },
  { symbol: 'WIPRO', name: 'Wipro Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 298.75, open: 297.20, high: 301.50, low: 296.80, volume: 13500000, change: 1.55, changePercent: 0.52 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Limited', exchange: 'NSE', lot: 1, tick: 0.05, price: 752.40, open: 748.60, high: 756.80, low: 746.30, volume: 19800000, change: 3.80, changePercent: 0.51 },
  { symbol: 'NIFTY', name: 'Nifty 50', exchange: 'NSE', lot: 50, tick: 0.05, price: 22456.75, open: 22420.50, high: 22485.30, low: 22405.80, volume: 0, change: 36.25, changePercent: 0.16 },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty', exchange: 'NSE', lot: 25, tick: 0.05, price: 48326.90, open: 48280.40, high: 48365.70, low: 48250.15, volume: 0, change: 46.50, changePercent: 0.10 },
];

class MarketDataService {
  private symbols: Map<string, Symbol> = new Map();
  private historicalCache: Map<string, Map<string, OHLCV[]>> = new Map();
  
  constructor() {
    SYMBOLS.forEach(s => this.symbols.set(s.symbol, s));
    this.generateHistoricalData();
  }

  getSymbols(): Symbol[] {
    return Array.from(this.symbols.values());
  }

  getSymbol(symbol: string): Symbol | undefined {
    return this.symbols.get(symbol);
  }

  searchSymbols(query: string): Symbol[] {
    const q = query.toLowerCase();
    return this.getSymbols().filter(s => 
      s.symbol.toLowerCase().includes(q) || 
      s.name.toLowerCase().includes(q)
    );
  }

  private generateHistoricalData() {
    const timeframes: Array<{ tf: string; interval: number; count: number }> = [
      { tf: '1s', interval: 1000, count: 300 },
      { tf: '5s', interval: 5 * 1000, count: 300 },
      { tf: '30s', interval: 30 * 1000, count: 300 },
      { tf: '1m', interval: 60 * 1000, count: 1000 },
      { tf: '5m', interval: 5 * 60 * 1000, count: 500 },
      { tf: '15m', interval: 15 * 60 * 1000, count: 400 },
      { tf: '30m', interval: 30 * 60 * 1000, count: 400 },
      { tf: '1h', interval: 60 * 60 * 1000, count: 300 },
      { tf: '2h', interval: 2 * 60 * 60 * 1000, count: 250 },
      { tf: '4h', interval: 4 * 60 * 60 * 1000, count: 200 },
      { tf: '1D', interval: 24 * 60 * 60 * 1000, count: 500 },
      { tf: '1W', interval: 7 * 24 * 60 * 60 * 1000, count: 200 },
    ];

    this.symbols.forEach((symbol, sym) => {
      const tfMap = new Map<string, OHLCV[]>();
      
      timeframes.forEach(({ tf, interval, count }) => {
        const candles: OHLCV[] = [];
        const basePrice = symbol.price;
        const now = Date.now();
        let price = basePrice * 0.95; // Start at 95% of current
        
        for (let i = count - 1; i >= 0; i--) {
          const time = now - (i * interval);
          const volatility = 0.02;
          const trend = (count - i) / count * 0.05; // slight uptrend
          
          const open = price;
          const change = (Math.random() - 0.48) * price * volatility + price * trend / count;
          price = Math.max(open + change, price * 0.95);
          
          const high = Math.max(open, price) * (1 + Math.random() * 0.01);
          const low = Math.min(open, price) * (1 - Math.random() * 0.01);
          const close = price;
          const volume = Math.floor(Math.random() * 1000000) + 100000;
          
          candles.push({ time, open, high, low, close, volume });
        }
        
        tfMap.set(tf, candles);
      });
      
      this.historicalCache.set(sym, tfMap);
    });
  }

  getHistoricalData(symbol: string, timeframe: string = '1m', limit: number = 500): OHLCV[] {
    const tfMap = this.historicalCache.get(symbol);
    if (!tfMap) return [];
    
    const candles = tfMap.get(timeframe) || [];
    return candles.slice(-limit);
  }

  getMarketDepth(symbol: string): MarketDepth {
    const sym = this.symbols.get(symbol);
    if (!sym) {
      return { symbol, bids: [], asks: [], timestamp: Date.now() };
    }

    const bids: DepthLevel[] = [];
    const asks: DepthLevel[] = [];
    const spread = sym.tick * 2;
    
    // Generate 10 levels of depth
    for (let i = 0; i < 10; i++) {
      const bidPrice = sym.price - spread - (i * sym.tick);
      const askPrice = sym.price + spread + (i * sym.tick);
      const quantity = Math.floor(Math.random() * 500) + 100;
      const orders = Math.floor(Math.random() * 10) + 1;
      
      bids.push({ price: bidPrice, quantity, orders });
      asks.push({ price: askPrice, quantity, orders });
    }

    return {
      symbol,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }

  updatePrice(symbol: string, newPrice: number) {
    const sym = this.symbols.get(symbol);
    if (sym) {
      const change = newPrice - sym.price;
      const changePercent = (change / sym.price) * 100;
      this.symbols.set(symbol, {
        ...sym,
        price: newPrice,
        change,
        changePercent,
      });
    }
  }

  // Generate next candle for real-time updates
  generateNextCandle(symbol: string, timeframe: string): OHLCV | null {
    const tfMap = this.historicalCache.get(symbol);
    const sym = this.symbols.get(symbol);
    if (!tfMap || !sym) return null;

    const candles = tfMap.get(timeframe);
    if (!candles || candles.length === 0) return null;

    const lastCandle = candles[candles.length - 1];
    const intervals: Record<string, number> = {
      '1s': 1000,
      '5s': 5 * 1000,
      '30s': 30 * 1000,
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
    };

    const interval = intervals[timeframe] || 60 * 1000;
    const time = lastCandle.time + interval;
    const open = lastCandle.close;
    const volatility = 0.005;
    const change = (Math.random() - 0.5) * open * volatility;
    const close = Math.max(open + change, open * 0.99);
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    const volume = Math.floor(Math.random() * 1000000) + 100000;

    const newCandle = { time, open, high, low, close, volume };
    candles.push(newCandle);
    
    // Keep only last 1000 candles
    if (candles.length > 1000) {
      candles.shift();
    }

    return newCandle;
  }
}

export const marketDataService = new MarketDataService();
