import { configureStore } from '@reduxjs/toolkit';
import tradingReducer from './tradingSlice';
import authReducer from './authSlice';

export const store = configureStore({
  reducer: {
    trading: tradingReducer,
    auth: authReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
