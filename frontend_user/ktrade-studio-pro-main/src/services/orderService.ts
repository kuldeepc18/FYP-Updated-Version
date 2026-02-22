import { Order, OrderType, OrderSide, OrderStatus, OrderValidity, Position, Trade } from '@/types/trading';
import { marketDataService } from './marketData';

class OrderService {
  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private orderIdCounter = 1;

  placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopPrice?: number;
    targetPrice?: number;
    stopLoss?: number;
    validity: OrderValidity;
  }): Order {
    const orderId = `ORD${Date.now()}${this.orderIdCounter++}`;
    const fees = this.calculateFees(params.quantity, params.price || 0);

    const order: Order = {
      id: orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      targetPrice: params.targetPrice,
      stopLoss: params.stopLoss,
      status: params.type === 'MARKET' ? 'PENDING' : 'OPEN',
      validity: params.validity,
      filledQuantity: 0,
      fees,
      timestamp: Date.now(),
    };

    this.orders.set(orderId, order);

    // Simulate order execution for market orders
    if (params.type === 'MARKET') {
      setTimeout(() => this.executeMarketOrder(orderId), Math.random() * 1000 + 500);
    }

    return order;
  }

  private executeMarketOrder(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'PENDING') return;

    const symbol = marketDataService.getSymbol(order.symbol);
    if (!symbol) return;

    // Simulate slippage
    const slippage = symbol.tick * (Math.random() * 3);
    const executionPrice = order.side === 'BUY' 
      ? symbol.price + slippage 
      : symbol.price - slippage;

    order.status = 'FILLED';
    order.filledQuantity = order.quantity;
    order.averagePrice = executionPrice;
    order.fillTimestamp = Date.now();

    this.orders.set(orderId, order);

    // Update position
    this.updatePosition(order);

    // Create trade
    const trade: Trade = {
      id: `TRD${Date.now()}`,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: executionPrice,
      fees: order.fees,
      netPnl: 0,
      timestamp: Date.now(),
    };
    this.trades.push(trade);
  }

  private updatePosition(order: Order) {
    if (order.status !== 'FILLED' || !order.averagePrice) return;

    const existingPosition = this.positions.get(order.symbol);
    
    if (!existingPosition) {
      // New position
      if (order.side === 'BUY') {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          quantity: order.quantity,
          averagePrice: order.averagePrice,
          currentPrice: order.averagePrice,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          side: 'BUY',
          timestamp: Date.now(),
        });
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          quantity: order.quantity,
          averagePrice: order.averagePrice,
          currentPrice: order.averagePrice,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          side: 'SELL',
          timestamp: Date.now(),
        });
      }
    } else {
      // Update existing position
      if (existingPosition.side === order.side) {
        // Adding to position
        const totalQuantity = existingPosition.quantity + order.quantity;
        const newAvgPrice = 
          (existingPosition.averagePrice * existingPosition.quantity + 
           order.averagePrice * order.quantity) / totalQuantity;
        
        existingPosition.quantity = totalQuantity;
        existingPosition.averagePrice = newAvgPrice;
        this.positions.set(order.symbol, existingPosition);
      } else {
        // Reducing or closing position
        if (order.quantity >= existingPosition.quantity) {
          // Close position
          this.positions.delete(order.symbol);
        } else {
          // Reduce position
          existingPosition.quantity -= order.quantity;
          this.positions.set(order.symbol, existingPosition);
        }
      }
    }
  }

  cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status === 'FILLED' || order.status === 'CANCELLED') {
      return false;
    }

    order.status = 'CANCELLED';
    this.orders.set(orderId, order);
    return true;
  }

  modifyOrder(orderId: string, updates: { price?: number; quantity?: number }): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'OPEN') {
      return false;
    }

    if (updates.price !== undefined) {
      order.price = updates.price;
    }
    if (updates.quantity !== undefined) {
      order.quantity = updates.quantity;
      order.fees = this.calculateFees(updates.quantity, order.price || 0);
    }

    this.orders.set(orderId, order);
    return true;
  }

  getOrders(): Order[] {
    return Array.from(this.orders.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getTrades(): Trade[] {
    return this.trades.sort((a, b) => b.timestamp - a.timestamp);
  }

  updatePositionPrices(symbol: string, currentPrice: number) {
    const position = this.positions.get(symbol);
    if (!position) return;

    position.currentPrice = currentPrice;
    
    if (position.side === 'BUY') {
      position.unrealizedPnl = (currentPrice - position.averagePrice) * position.quantity;
    } else {
      position.unrealizedPnl = (position.averagePrice - currentPrice) * position.quantity;
    }
    
    position.unrealizedPnlPercent = (position.unrealizedPnl / (position.averagePrice * position.quantity)) * 100;
    
    this.positions.set(symbol, position);
  }

  private calculateFees(quantity: number, price: number): number {
    const value = quantity * price;
    const brokerage = Math.min(value * 0.0003, 20); // 0.03% or ₹20 whichever is lower
    const stt = value * 0.00025; // 0.025%
    const transactionCharges = value * 0.0000325; // 0.00325%
    const gst = (brokerage + transactionCharges) * 0.18;
    const sebiCharges = value * 0.000001;
    const stampDuty = value * 0.00003;
    
    return brokerage + stt + transactionCharges + gst + sebiCharges + stampDuty;
  }

  // Simulate limit order matching
  checkLimitOrders() {
    this.orders.forEach(order => {
      if (order.status !== 'OPEN' || order.type === 'MARKET') return;
      
      const symbol = marketDataService.getSymbol(order.symbol);
      if (!symbol) return;

      let shouldFill = false;

      if (order.type === 'LIMIT') {
        if (order.side === 'BUY' && order.price && symbol.price <= order.price) {
          shouldFill = true;
        } else if (order.side === 'SELL' && order.price && symbol.price >= order.price) {
          shouldFill = true;
        }
      }

      if (shouldFill) {
        order.status = 'FILLED';
        order.filledQuantity = order.quantity;
        order.averagePrice = order.price;
        order.fillTimestamp = Date.now();
        this.orders.set(order.id, order);
        this.updatePosition(order);
      }
    });
  }

  resetDemo() {
    this.orders.clear();
    this.positions.clear();
    this.trades = [];
    this.orderIdCounter = 1;
  }
}

export const orderService = new OrderService();
