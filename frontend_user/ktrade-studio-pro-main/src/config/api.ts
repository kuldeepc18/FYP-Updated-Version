import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const authData = localStorage.getItem('ktrade_auth');
  if (authData) {
    try {
      const { token } = JSON.parse(authData);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error parsing auth data:', error);
    }
  }
  return config;
});

// Handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ktrade_auth');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
  },
  USER: {
    BALANCE_ADD: '/user/balance/add',
    BALANCE_WITHDRAW: '/user/balance/withdraw',
    ORDERS: '/user/orders',
    ORDERS_PLACE: '/user/orders',
    ORDERS_CANCEL: '/user/orders',  // append /:id
    ORDERS_UPDATE: '/user/orders',  // append /:id  (PATCH)
    MY_TRADES: '/user/mytrades',
    POSITIONS: '/user/positions',
    POSITIONS_EXIT: '/user/positions/exit',
    POSITIONS_EXIT_ALL: '/user/positions/exit-all',
  },
  MARKET: {
    QUOTES: '/market/quotes',
    QUOTES_STREAM: '/market/quotes/stream',
    ORDERBOOK: '/market/orderbook',  // append /:instrumentId
    ORDERBOOK_STREAM: '/market/orderbook', // append /:instrumentId/stream
    SEARCH: '/market/search',
  },
  PORTFOLIO: {
    HOLDINGS: '/portfolio/holdings',
    POSITIONS: '/portfolio/positions',
  },
  ORDERS: {
    CREATE: '/user/orders',
    LIST: '/user/orders',
    CANCEL: '/user/orders',  // append /:id
  },
} as const;
