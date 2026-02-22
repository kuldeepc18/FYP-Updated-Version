import { Tick } from '@/types/trading';

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
      
      // Also broadcast to individual symbol subscribers
      if (Array.isArray(data.data)) {
        data.data.forEach((symbolData: any) => {
          const tick: Tick = {
            symbol: symbolData.symbol,
            price: symbolData.price,
            volume: Math.floor(Math.random() * 10000) + 1000,
            timestamp: symbolData.timestamp || Date.now(),
          };
          this.broadcast(`tick:${symbolData.symbol}`, tick);
        });
      }
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

    // Send subscription request to backend
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        symbols: channel.startsWith('tick:') ? [channel.replace('tick:', '')] : []
      }));
    }
  }

  unsubscribe(channel: string, handler: MessageHandler) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(channel);
      }
    }
  }

  private broadcast(channel: string, data: any) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const websocketService = new WebSocketService();
export default websocketService;
