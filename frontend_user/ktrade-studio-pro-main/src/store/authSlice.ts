import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface User {
  id: string;
  numericId?: number | null;
  email: string;
  name: string;
  balance: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
    },
    clearAuth: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
    },
    updateUserBalance: (state, action: PayloadAction<number>) => {
      if (state.user) {
        state.user = { ...state.user, balance: action.payload };
        // Persist the updated balance into localStorage so it survives a page refresh
        try {
          const stored = localStorage.getItem('ktrade_auth');
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.user = { ...parsed.user, balance: action.payload };
            localStorage.setItem('ktrade_auth', JSON.stringify(parsed));
          }
        } catch {}
      }
    },
  },
});

export const { setAuth, clearAuth, updateUserBalance } = authSlice.actions;
export default authSlice.reducer;
