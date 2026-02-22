import { ReactNode, useEffect } from 'react';
import { TopNav } from './TopNav';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { authService } from '@/services/auth';
import { setAuth } from '@/store/authSlice';
import { websocketService } from '@/services';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  useEffect(() => {
    // Check auth on mount
    const authState = authService.getAuthState();
    if (authState) {
      dispatch(setAuth(authState));
      
      // Connect WebSocket
      if (!websocketService.isConnected()) {
        websocketService.connect();
      }
    } else {
      navigate('/auth/login');
    }
  }, [dispatch, navigate]);

  useEffect(() => {
    // Apply theme on mount
    const theme = localStorage.getItem('ktrade_theme') || 'dark';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="w-full">{children}</main>
    </div>
  );
};
