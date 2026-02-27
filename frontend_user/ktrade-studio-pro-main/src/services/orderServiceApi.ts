import { apiClient, API_ENDPOINTS } from '@/config/api';
import { Order, OrderType, OrderSide, OrderValidity, Position, Trade } from '@/types/trading';
import { MyTrade } from '@/store/tradingSlice';

class OrderServiceApi {
  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopPrice?: number;
    targetPrice?: number;
    stopLoss?: number;
    validity: OrderValidity;
  }): Promise<Order> {
    const response = await apiClient.post(API_ENDPOINTS.USER.ORDERS_PLACE, {
      symbol     : params.symbol,
      side       : params.side,
      orderType  : params.type,
      quantity   : params.quantity,
      price      : params.price,
      stopPrice  : params.stopPrice,
      targetPrice: params.targetPrice,
      stopLoss   : params.stopLoss,
      validity   : params.validity,
    });
    const d = response.data;
    return {
      id            : d.id,
      symbol        : d.symbol,
      side          : d.side,
      type          : d.orderType || d.type,
      quantity      : d.quantity,
      price         : d.price,
      stopPrice     : d.stopPrice,
      targetPrice   : d.targetPrice,
      stopLoss      : d.stopLoss,
      status        : d.status,
      validity      : d.validity,
      filledQuantity: d.filledQuantity || 0,
      fees          : d.fees || 0,
      timestamp     : d.timestamp,
      fillTimestamp : d.fillTimestamp,
      averagePrice  : d.averagePrice,
    };
  }

  async getOrders(): Promise<Order[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.USER.ORDERS);
      return (response.data as any[]).map(d => ({
        id            : d.id,
        symbol        : d.symbol,
        side          : d.side,
        type          : d.orderType || d.type,
        quantity      : d.quantity,
        price         : d.price,
        stopPrice     : d.stopPrice,
        targetPrice   : d.targetPrice,
        stopLoss      : d.stopLoss,
        status        : d.status,
        validity      : d.validity,
        filledQuantity: d.filledQuantity || 0,
        fees          : d.fees || 0,
        timestamp     : d.timestamp,
        fillTimestamp : d.fillTimestamp,
        averagePrice  : d.averagePrice,
      }));
    } catch {
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await apiClient.delete(`${API_ENDPOINTS.USER.ORDERS_CANCEL}/${orderId}`);
      return true;
    } catch {
      return false;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.USER.POSITIONS);
      return (response.data as any[]).map(d => ({
        symbol              : d.symbol,
        quantity            : d.quantity,
        averagePrice        : d.averagePrice,
        currentPrice        : d.currentPrice || d.averagePrice,
        unrealizedPnl       : d.unrealizedPnl || 0,
        unrealizedPnlPercent: d.unrealizedPnlPercent || 0,
        side                : d.side || 'BUY',
        timestamp           : d.timestamp || Date.now(),
      }));
    } catch {
      return [];
    }
  }

  async getMyTrades(): Promise<MyTrade[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.USER.MY_TRADES);
      return response.data as MyTrade[];
    } catch {
      return [];
    }
  }

  async exitPosition(symbol: string): Promise<boolean> {
    try {
      await apiClient.post(API_ENDPOINTS.USER.POSITIONS_EXIT, { symbol });
      return true;
    } catch {
      return false;
    }
  }

  async exitAllPositions(): Promise<boolean> {
    try {
      await apiClient.post(API_ENDPOINTS.USER.POSITIONS_EXIT_ALL);
      return true;
    } catch {
      return false;
    }
  }

  async updateOrderTargetSL(orderId: string, targetPrice: number | null, stopLoss: number | null): Promise<boolean> {
    try {
      await apiClient.patch(`${API_ENDPOINTS.USER.ORDERS_UPDATE}/${orderId}`, { targetPrice, stopLoss });
      return true;
    } catch {
      return false;
    }
  }

  async getTrades(): Promise<Trade[]> {
    try {
      const orders = await this.getOrders();
      return orders
        .filter(o => o.status === 'FILLED')
        .map(o => ({
          id       : `TRD${o.id}`,
          orderId  : o.id,
          symbol   : o.symbol,
          side     : o.side,
          quantity : o.quantity,
          price    : o.averagePrice || o.price || 0,
          fees     : o.fees || 0,
          netPnl   : 0,
          timestamp: o.fillTimestamp || o.timestamp,
        }));
    } catch {
      return [];
    }
  }
}

export const orderServiceApi = new OrderServiceApi();
export default orderServiceApi;
