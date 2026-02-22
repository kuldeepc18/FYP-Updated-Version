import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/admin';

export const adminApiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Add auth token to requests
adminApiClient.interceptors.request.use((config) => {
  try {
    const stored = localStorage.getItem('adminSession');
    if (stored) {
      const { token } = JSON.parse(stored);
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // corrupt storage – ignore
  }
  return config;
});

// Handle auth errors – only redirect when NOT already on the login page
adminApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !window.location.pathname.includes('/admin/login')
    ) {
      localStorage.removeItem('adminSession');
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

export const ADMIN_API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
  },
  MARKET: {
    DATA: '/market/data',
    SYMBOLS: '/market/symbols',
  },
  ORDERS: {
    BOOK: '/orders/book',
    HISTORY: '/orders/history',
  },
  TRADES: {
    HISTORY: '/trades/history',
    STATS: '/trades/stats',
  },
  ML: {
    PREDICTIONS: '/ml/predictions',
    METRICS: '/ml/metrics',
  },
  SURVEILLANCE: {
    ALERTS: '/surveillance/alerts',
    PATTERNS: '/surveillance/patterns',
  },
} as const;
