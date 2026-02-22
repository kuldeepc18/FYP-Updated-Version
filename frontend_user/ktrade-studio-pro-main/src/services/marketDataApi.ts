import { apiClient, API_ENDPOINTS } from '@/config/api';
import { Symbol, OHLCV } from '@/types/trading';

class MarketDataService {
  private wsConnection: WebSocket | null = null;
  private marketUpdateCallbacks: Set<(data: any) => void> = new Set();

  async getSymbols(): Promise<Symbol[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.MARKET.QUOTES);
      return response.data.map((inst: any) => ({
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange || 'NSE',
        lot: 1,
        tick: 0.05,
        price: inst.marketPrice,
        open: inst.marketPrice * 0.995,
        high: inst.marketPrice * 1.01,
        low: inst.marketPrice * 0.99,
        volume: Math.floor(Math.random() * 10000000),
        change: inst.change || 0,
        changePercent: inst.changePercent || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch symbols from backend:', error);
      return [];
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
      const response = await apiClient.get(`${API_ENDPOINTS.MARKET.SEARCH}?q=${query}`);
      return response.data.map((inst: any) => ({
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange || 'NSE',
        lot: 1,
        tick: 0.05,
        price: inst.marketPrice,
        open: inst.marketPrice * 0.995,
        high: inst.marketPrice * 1.01,
        low: inst.marketPrice * 0.99,
        volume: Math.floor(Math.random() * 10000000),
        change: inst.change || 0,
        changePercent: inst.changePercent || 0,
      }));
    } catch (error) {
      console.error('Failed to search symbols:', error);
      return [];
    }
  }

  async getHistoricalData(symbol: string, timeframe: string = '1m', limit: number = 500): Promise<OHLCV[]> {
    // Generate mock historical data since backend doesn't have this endpoint yet
    const sym = await this.getSymbol(symbol);
    if (!sym) return [];

    const candles: OHLCV[] = [];
    const basePrice = sym.price;
    const now = Date.now();
    let price = basePrice * 0.95;
    
    const interval = timeframe === '1m' ? 60000 : timeframe === '5m' ? 300000 : 3600000;
    
    for (let i = limit - 1; i >= 0; i--) {
      const time = now - (i * interval);
      const volatility = 0.02;
      
      const open = price;
      const change = (Math.random() - 0.48) * price * volatility;
      price = Math.max(open + change, price * 0.95);
      
      const high = Math.max(open, price) * (1 + Math.random() * 0.01);
      const low = Math.min(open, price) * (1 - Math.random() * 0.01);
      const close = price;
      const volume = Math.floor(Math.random() * 1000000) + 100000;
      
      candles.push({ time, open, high, low, close, volume });
    }
    
    return candles;
  }

  async getOrderBook(symbol: string): Promise<any> {
    try {
      const response = await apiClient.get(`/market/orderbook/${symbol}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch order book:', error);
      return { bids: [], asks: [], lastUpdate: Date.now() };
    }
  }

  async getMarketDepth(symbol: string): Promise<any> {
    try {
      const orderBook = await this.getOrderBook(symbol);
      return {
        bids: orderBook.bids || [],
        asks: orderBook.asks || [],
        lastUpdate: orderBook.lastUpdate || Date.now()
      };
    } catch (error) {
      console.error('Failed to fetch market depth:', error);
      return { bids: [], asks: [], lastUpdate: Date.now() };
    }
  }

  async getOHLCVData(symbol: string, interval: string, from: number, to: number): Promise<OHLCV[]> {
    // For now, use getHistoricalData as backend doesn't have OHLCV endpoint
    const days = Math.ceil((to - from) / (24 * 60 * 60 * 1000));
    return this.getHistoricalData(symbol, interval, days * 24);
  }

  // WebSocket connection for real-time updates
  connectWebSocket() {
    if (this.wsConnection) return;

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
    this.wsConnection = new WebSocket(wsUrl);

    this.wsConnection.onopen = () => {
      console.log('[WebSocket] Connected to backend');
    };

    this.wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'market_update') {
          this.marketUpdateCallbacks.forEach(callback => callback(data.data));
        }
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    };

    this.wsConnection.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    this.wsConnection.onclose = () => {
      console.log('[WebSocket] Disconnected');
      this.wsConnection = null;
      // Attempt reconnection after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  onMarketUpdate(callback: (data: any) => void) {
    this.marketUpdateCallbacks.add(callback);
  }

  offMarketUpdate(callback: (data: any) => void) {
    this.marketUpdateCallbacks.delete(callback);
  }

  disconnectWebSocket() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }
}

export const marketDataService = new MarketDataService();
export default marketDataService;
