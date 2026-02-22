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
  MARKET: {
    QUOTES: '/market/quotes',
    SEARCH: '/market/search',
  },
  PORTFOLIO: {
    HOLDINGS: '/portfolio/holdings',
    POSITIONS: '/portfolio/positions',
  },
  ORDERS: {
    CREATE: '/orders',
    LIST: '/orders',
    CANCEL: '/orders/:id',
  },
} as const;
