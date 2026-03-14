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
    open         : inst.sessionOpenPrice ?? inst.marketPrice ?? 0,
    high         : inst.high24h    ?? inst.marketPrice ?? 0,
    low          : inst.low24h     ?? inst.marketPrice ?? 0,
    volume       : inst.volume     ?? 0,
    change       : inst.change     ?? 0,
    changePercent: inst.changePercent ?? 0,
    // Circuit-breaker fields from backend
    circuitStatus: inst.circuitStatus ?? 'NONE',
    circuitBand  : inst.circuitBand   ?? 0,
    basePrice    : inst.basePrice     ?? inst.marketPrice ?? 0,
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

  async getHistoricalData(symbol: string, timeframe: string = '1D', limit: number = 90): Promise<OHLCV[]> {
    try {
      const encodedSymbol = encodeURIComponent(symbol);
      const response = await apiClient.get(
        `/market/historical/${encodedSymbol}?interval=${timeframe}&limit=${limit}`
      );
      return (response.data as any[]).map((c: any) => ({
        time  : c.time,
        open  : c.open,
        high  : c.high,
        low   : c.low,
        close : c.close,
        volume: c.volume || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch historical data from backend:', error);
      return [];
    }
  }

  async getOHLCVData(symbol: string, interval: string, from: number, to: number): Promise<OHLCV[]> {
    const days  = Math.ceil((to - from) / (24 * 60 * 60 * 1000));
    const limit = Math.min(Math.max(days, 1) * (interval === '1D' ? 1 : 24), 500);
    return this.getHistoricalData(symbol, interval, limit);
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

