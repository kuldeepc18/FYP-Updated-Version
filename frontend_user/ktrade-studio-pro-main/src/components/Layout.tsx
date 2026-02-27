import { ReactNode, useEffect, useState } from 'react';
import { TopNav } from './TopNav';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { authService } from '@/services/auth';
import { setAuth } from '@/store/authSlice';
import { setTheme } from '@/store/tradingSlice';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Restore theme: read from localStorage and sync Redux + DOM
    const savedTheme = (localStorage.getItem('ktrade_theme') as 'light' | 'dark') || 'dark';
    dispatch(setTheme(savedTheme)); // applies DOM class + saves to localStorage via reducer

    // Check auth on mount
    const authState = authService.getAuthState();
    if (authState && authState.user && authState.token) {
      dispatch(setAuth({ user: authState.user, token: authState.token }));
    } else {
      navigate('/auth/login');
    }
    setAuthChecked(true);
  }, [dispatch, navigate]);

  // Show a minimal loading screen while the auth check runs (avoids black flash)
  if (!authChecked || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">KT</span>
          </div>
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="w-full">{children}</main>
    </div>
  );
};
