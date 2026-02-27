import { apiClient, API_ENDPOINTS } from '@/config/api';
import { Symbol, OHLCV } from '@/types/trading';

// Convert a raw backend quote object into the frontend Symbol shape
function toSymbol(inst: any): Symbol {
  return {
    symbol       : inst.symbol,
    name         : inst.name,
    exchange     : 'NSE',
    lot          : 1,
    tick         : 0.05,
    price        : inst.marketPrice ?? inst.price ?? 0,
    open         : inst.marketPrice ?? 0,
    high         : inst.high24h    ?? inst.marketPrice ?? 0,
    low          : inst.low24h     ?? inst.marketPrice ?? 0,
    volume       : inst.volume     ?? 0,
    change       : inst.change     ?? 0,
    changePercent: inst.changePercent ?? 0,
  };
}

class MarketDataService {
  private sseSource: EventSource | null = null;
  private marketUpdateCallbacks: Set<(symbols: Symbol[]) => void> = new Set();
  private latestSymbols: Symbol[] = [];

  async getSymbols(): Promise<Symbol[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.MARKET.QUOTES);
      this.latestSymbols = (response.data as any[]).map(toSymbol);
      return this.latestSymbols;
    } catch (error) {
      console.error('Failed to fetch symbols from backend:', error);
      return this.latestSymbols; // return last-known on error
    }
  }

  async getSymbol(symbol: string): Promise<Symbol | undefined> {
    try {
      const symbols = await this.getSymbols();
      return symbols.find(s => s.symbol === symbol);
    } catch (error) {
      console.error('Failed to fetch symbol:', error);
      return undefined;
    }
  }

  async searchSymbols(query: string): Promise<Symbol[]> {
    try {
      const all = await this.getSymbols();
      const q = query.toLowerCase();
      return all.filter(
        s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    } catch (error) {
      console.error('Failed to search symbols:', error);
      return [];
    }
  }

  async getHistoricalData(symbol: string, timeframe: string = '1m', limit: number = 500): Promise<OHLCV[]> {
    const sym = await this.getSymbol(symbol);
    if (!sym) return [];

    const candles: OHLCV[] = [];
    const basePrice = sym.price;
    const now = Date.now();
    let price = basePrice * 0.95;
    const interval = timeframe === '1m' ? 60000 : timeframe === '5m' ? 300000 : 3600000;

    for (let i = limit - 1; i >= 0; i--) {
      const time       = now - (i * interval);
      const open       = price;
      const change     = (Math.random() - 0.48) * price * 0.02;
      price            = Math.max(open + change, price * 0.95);
      const high       = Math.max(open, price) * (1 + Math.random() * 0.01);
      const low        = Math.min(open, price) * (1 - Math.random() * 0.01);
      const volume     = Math.floor(Math.random() * 1000000) + 100000;
      candles.push({ time, open, high, low, close: price, volume });
    }
    return candles;
  }

  async getOrderBook(symbol: string): Promise<any> {
    try {
      const response = await apiClient.get(`/market/orderbook/${symbol}`);
      return response.data;
    } catch {
      return { bids: [], asks: [], lastUpdate: Date.now() };
    }
  }

  async getMarketDepth(symbol: string): Promise<any> {
    try {
      const ob = await this.getOrderBook(symbol);
      return { bids: ob.bids || [], asks: ob.asks || [], lastUpdate: ob.lastUpdate || Date.now() };
    } catch {
      return { bids: [], asks: [], lastUpdate: Date.now() };
    }
  }

  async getOHLCVData(symbol: string, interval: string, from: number, to: number): Promise<OHLCV[]> {
    const days = Math.ceil((to - from) / (24 * 60 * 60 * 1000));
    return this.getHistoricalData(symbol, interval, days * 24);
  }

  // ── SSE-based real-time market data stream ──────────────────────────────────
  //
  // Opens a single persistent SSE connection to /api/market/quotes/stream and
  // notifies all registered callbacks every time new data arrives (~2 s cadence).
  startRealtimeStream() {
    if (this.sseSource) return; // already connected

    const base = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api')
      .replace(/\/api$/, ''); // strip trailing /api
    const url = `${base}/api${API_ENDPOINTS.MARKET.QUOTES_STREAM}`;

    try {
      this.sseSource = new EventSource(url);

      this.sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            const symbols = data.map(toSymbol);
            this.latestSymbols = symbols;
            this.marketUpdateCallbacks.forEach(cb => cb(symbols));
          }
        } catch {/* ignore parse errors */}
      };

      this.sseSource.onerror = () => {
        // Browser auto-reconnects on error; close and let it retry
        this.sseSource?.close();
        this.sseSource = null;
        setTimeout(() => this.startRealtimeStream(), 5000);
      };
    } catch (err) {
      console.error('[SSE] Failed to open quote stream:', err);
    }
  }

  stopRealtimeStream() {
    this.sseSource?.close();
    this.sseSource = null;
  }

  onMarketUpdate(callback: (symbols: Symbol[]) => void) {
    this.marketUpdateCallbacks.add(callback);
  }

  offMarketUpdate(callback: (symbols: Symbol[]) => void) {
    this.marketUpdateCallbacks.delete(callback);
  }

  // Legacy WebSocket shim — kept for components that call connectWebSocket()
  connectWebSocket() {
    this.startRealtimeStream();
  }
}

export const marketDataService = new MarketDataService();
export default marketDataService;

