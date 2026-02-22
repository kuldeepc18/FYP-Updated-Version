import { Tick } from '@/types/trading';
import { marketDataService } from './marketDataApi';

type MessageHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private connected: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  connect() {
    if (this.connected || this.ws) return;
    
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        this.connected = true;
        console.log('[WebSocket] Connected to backend server');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };
      
      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        console.log('[WebSocket] Disconnected, attempting reconnection...');
        
        // Attempt reconnection after 5 seconds
        this.reconnectTimeout = setTimeout(() => {
          this.connect();
        }, 5000);
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
    }
  }
  
  private handleMessage(data: any) {
    if (data.type === 'market_update') {
      // Broadcast to all market update subscribers
      const handlers = this.subscribers.get('market') || new Set();
      handlers.forEach(handler => handler(data.data));
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connected = false;
    console.log('[WebSocket] Disconnected');
  }

  subscribe(channel: string, handler: MessageHandler) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(handler);

    // If subscribing to a symbol tick, start generating ticks
    if (channel.startsWith('tick:')) {
      cSend subscription request to backend
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: channel
      }));
    }
  }

  unsubscribe(channel: string, handler: MessageHandler) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(channel);
        
        // Send unsubscribe request to backend
        if (this.ws && this.connected) {
          this.ws.send(JSON.stringify({
            type: 'unsubscribe',
            channel: channel
          }));
        }
      }
    }
  }

  isConnected(): boolean {
    return this.connectedx(sym.price + change, sym.price * 0.95);

      marketDataService.updatePrice(symbol, newPrice);
      orderService.updatePositionPrices(symbol, newPrice);

      const tick: Tick = {
        symbol,
        price: newPrice,
        volume: Math.floor(Math.random() * 10000) + 1000,
        timestamp: Date.now(),
      };

      this.broadcast(`tick:${symbol}`, tick);
    }, 500);

    this.tickIntervals.set(symbol, interval);
  }

  private stopTickGeneration(symbol: string) {
    const interval = this.tickIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.tickIntervals.delete(symbol);
    }
  }

  private broadcast(channel: string, data: any) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  private broadcastMarketUpdate() {
    // Update all symbol prices slightly
    const symbols = marketDataService.getSymbols();
    symbols.forEach(symbol => {
      const volatility = 0.0005;
      const change = (Math.random() - 0.5) * symbol.price * volatility;
      const newPrice = Math.max(symbol.price + change, symbol.price * 0.99);
      marketDataService.updatePrice(symbol.symbol, newPrice);
    });

    this.broadcast('market:update', { timestamp: Date.now() });
  }

  sendMessage(channel: string, data: any) {
    // Simulate sending message to server
    console.log(`[WebSocket] Send to ${channel}:`, data);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const websocketService = new WebSocketService();
