import { apiClient, API_ENDPOINTS } from '@/config/api';
import { Order, OrderType, OrderSide, OrderValidity, Position, Trade } from '@/types/trading';

class OrderServiceApi {
  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopPrice?: number;
    validity: OrderValidity;
  }): Promise<Order> {
    try {
      const response = await apiClient.post(API_ENDPOINTS.ORDERS.CREATE, {
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        quantity: params.quantity,
        price: params.price,
        stopPrice: params.stopPrice,
        validity: params.validity,
      });

      return {
        id: response.data.id,
        symbol: response.data.symbol,
        side: response.data.side,
        type: response.data.type,
        quantity: response.data.quantity,
        price: response.data.price,
        stopPrice: response.data.stopPrice,
        status: response.data.status,
        validity: response.data.validity,
        filledQuantity: response.data.filledQuantity || 0,
        fees: response.data.fees || 0,
        timestamp: response.data.timestamp,
        fillTimestamp: response.data.fillTimestamp,
        averagePrice: response.data.averagePrice,
      };
    } catch (error) {
      console.error('Failed to place order:', error);
      throw error;
    }
  }

  async getOrders(): Promise<Order[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.ORDERS.LIST);
      return response.data.map((order: any) => ({
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        stopPrice: order.stopPrice,
        status: order.status,
        validity: order.validity,
        filledQuantity: order.filledQuantity || 0,
        fees: order.fees || 0,
        timestamp: order.timestamp,
        fillTimestamp: order.fillTimestamp,
        averagePrice: order.averagePrice,
      }));
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await apiClient.delete(API_ENDPOINTS.ORDERS.CANCEL.replace(':id', orderId));
      return true;
    } catch (error) {
      console.error('Failed to cancel order:', error);
      return false;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.PORTFOLIO.POSITIONS);
      return response.data.map((pos: any) => ({
        symbol: pos.symbol,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        currentPrice: pos.currentPrice || pos.averagePrice,
        unrealizedPnL: pos.unrealizedPnL || 0,
        realizedPnL: pos.realizedPnL || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      return [];
    }
  }

  async getHoldings(): Promise<Position[]> {
    try {
      const response = await apiClient.get(API_ENDPOINTS.PORTFOLIO.HOLDINGS);
      return response.data.map((holding: any) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        averagePrice: holding.averagePrice,
        currentPrice: holding.currentPrice || holding.averagePrice,
        unrealizedPnL: holding.unrealizedPnL || 0,
        realizedPnL: holding.realizedPnL || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch holdings:', error);
      return [];
    }
  }

  async getTrades(): Promise<Trade[]> {
    try {
      const orders = await this.getOrders();
      return orders
        .filter(order => order.status === 'FILLED')
        .map(order => ({
          id: `TRD${order.id}`,
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          price: order.averagePrice || order.price || 0,
          fees: order.fees || 0,
          netPnl: 0,
          timestamp: order.fillTimestamp || order.timestamp,
        }));
    } catch (error) {
      console.error('Failed to fetch trades:', error);
      return [];
    }
  }
}

export const orderServiceApi = new OrderServiceApi();
export default orderServiceApi;
