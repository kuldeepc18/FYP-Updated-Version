import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Symbol, Order, Position, MarketDepth, OHLCV, Watchlist, Account, Trade } from '@/types/trading';

export interface MyTrade {
  symbol: string;
  name: string;
  quantity: number;
  averagePrice: number;
  avgSellPrice: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
}

interface TradingState {
  selectedSymbol: string;
  symbols: Symbol[];
  orders: Order[];
  positions: Position[];
  myTrades: MyTrade[];
  watchlists: Watchlist[];
  activeWatchlist: string;
  marketDepth: MarketDepth | null;
  account: Account;
  theme: 'light' | 'dark';
}

const DEFAULT_WATCHLIST: Watchlist = {
  id: 'default',
  name: 'My Watchlist',
  symbols: ['RELIANCE (NSE)', 'TCS (NSE)', 'HDFCBANK (NSE)', 'TATAMOTORS (NSE)', 'ADANIENT (NSE)'],
};

// Restore theme from localStorage so it survives page refreshes
const _savedTheme = (typeof window !== 'undefined'
  ? localStorage.getItem('ktrade_theme')
  : null) as 'light' | 'dark' | null;

const initialState: TradingState = {
  selectedSymbol: 'RELIANCE',
  symbols: [],
  orders: [],
  positions: [],
  myTrades: [],
  watchlists: [DEFAULT_WATCHLIST],
  activeWatchlist: 'default',
  marketDepth: null,
  account: {
    balance: 500000,
    equity: 500000,
    margin: 0,
    availableMargin: 500000,
    unrealizedPnl: 0,
    realizedPnl: 0,
  },
  theme: _savedTheme || 'dark',
};

const tradingSlice = createSlice({
  name: 'trading',
  initialState,
  reducers: {
    setSelectedSymbol: (state, action: PayloadAction<string>) => {
      state.selectedSymbol = action.payload;
    },
    setSymbols: (state, action: PayloadAction<Symbol[]>) => {
      state.symbols = action.payload;
    },
    updateSymbol: (state, action: PayloadAction<Symbol>) => {
      const index = state.symbols.findIndex(s => s.symbol === action.payload.symbol);
      if (index !== -1) {
        state.symbols[index] = action.payload;
      }
    },
    setOrders: (state, action: PayloadAction<Order[]>) => {
      state.orders = action.payload;
    },
    addOrder: (state, action: PayloadAction<Order>) => {
      state.orders.unshift(action.payload);
    },
    updateOrder: (state, action: PayloadAction<Order>) => {
      const index = state.orders.findIndex(o => o.id === action.payload.id);
      if (index !== -1) {
        state.orders[index] = action.payload;
      }
    },
    cancelOrder: (state, action: PayloadAction<string>) => {
      const index = state.orders.findIndex(o => o.id === action.payload);
      if (index !== -1) {
        state.orders[index].status = 'CANCELLED';
      }
    },
    setPositions: (state, action: PayloadAction<Position[]>) => {
      state.positions = action.payload;
    },
    setMyTrades: (state, action: PayloadAction<MyTrade[]>) => {
      state.myTrades = action.payload;
    },
    updatePosition: (state, action: PayloadAction<Position>) => {
      const index = state.positions.findIndex(p => p.symbol === action.payload.symbol);
      if (index !== -1) {
        state.positions[index] = action.payload;
      } else {
        state.positions.push(action.payload);
      }
    },
    setMarketDepth: (state, action: PayloadAction<MarketDepth>) => {
      state.marketDepth = action.payload;
    },
    addToWatchlist: (state, action: PayloadAction<{ watchlistId: string; symbol: string }>) => {
      const watchlist = state.watchlists.find(w => w.id === action.payload.watchlistId);
      if (watchlist && !watchlist.symbols.includes(action.payload.symbol)) {
        watchlist.symbols.push(action.payload.symbol);
      }
    },
    removeFromWatchlist: (state, action: PayloadAction<{ watchlistId: string; symbol: string }>) => {
      const watchlist = state.watchlists.find(w => w.id === action.payload.watchlistId);
      if (watchlist) {
        watchlist.symbols = watchlist.symbols.filter(s => s !== action.payload.symbol);
      }
    },
    createWatchlist: (state, action: PayloadAction<{ name: string }>) => {
      const newWatchlist: Watchlist = {
        id: `watchlist_${Date.now()}`,
        name: action.payload.name,
        symbols: [],
      };
      state.watchlists.push(newWatchlist);
    },
    setActiveWatchlist: (state, action: PayloadAction<string>) => {
      state.activeWatchlist = action.payload;
    },
    updateAccount: (state, action: PayloadAction<Partial<Account>>) => {
      state.account = { ...state.account, ...action.payload };
    },
    setTheme: (state, action: PayloadAction<'light' | 'dark'>) => {
      state.theme = action.payload;
      // Persist so that page refreshes and new tabs start with the correct theme
      try { localStorage.setItem('ktrade_theme', action.payload); } catch {}
      // Apply immediately to document so every page reflects the change
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', action.payload === 'dark');
      }
    },
    resetDemo: (state) => {
      state.orders = [];
      state.positions = [];
      state.account = {
        balance: 500000,
        equity: 500000,
        margin: 0,
        availableMargin: 500000,
        unrealizedPnl: 0,
        realizedPnl: 0,
      };
    },
  },
});

export const {
  setSelectedSymbol,
  setSymbols,
  updateSymbol,
  setOrders,
  addOrder,
  updateOrder,
  cancelOrder,
  setPositions,
  setMyTrades,
  updatePosition,
  setMarketDepth,
  addToWatchlist,
  removeFromWatchlist,
  createWatchlist,
  setActiveWatchlist,
  updateAccount,
  setTheme,
  resetDemo,
} = tradingSlice.actions;

export default tradingSlice.reducer;
