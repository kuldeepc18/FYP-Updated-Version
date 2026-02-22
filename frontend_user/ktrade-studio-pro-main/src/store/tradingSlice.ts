import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Symbol, Order, Position, MarketDepth, OHLCV, Watchlist, Account } from '@/types/trading';

interface TradingState {
  selectedSymbol: string;
  symbols: Symbol[];
  orders: Order[];
  positions: Position[];
  watchlists: Watchlist[];
  activeWatchlist: string;
  marketDepth: MarketDepth | null;
  account: Account;
  theme: 'light' | 'dark';
}

const DEFAULT_WATCHLIST: Watchlist = {
  id: 'default',
  name: 'My Watchlist',
  symbols: ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK'],
};

const initialState: TradingState = {
  selectedSymbol: 'RELIANCE',
  symbols: [],
  orders: [],
  positions: [],
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
  theme: 'dark',
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
