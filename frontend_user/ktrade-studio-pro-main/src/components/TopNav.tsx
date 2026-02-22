import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, User, LogOut, Settings, Moon, Sun, LayoutDashboard, Bookmark, Briefcase } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setTheme } from '@/store/tradingSlice';
import { clearAuth } from '@/store/authSlice';
import { authService } from '@/services/auth';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const TopNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);
  const { account, theme } = useAppSelector((state) => state.trading);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = async () => {
    await authService.logout();
    dispatch(clearAuth());
    navigate('/auth/login');
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    dispatch(setTheme(newTheme));
    document.documentElement.classList.toggle('dark');
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/trade', label: 'Trade', icon: null },
    { path: '/watchlist', label: 'Watchlist', icon: Bookmark },
    { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
  ];

  const isActive = (path: string) => {
    if (path === '/trade') {
      return location.pathname.startsWith('/trade');
    }
    return location.pathname === path;
  };

  return (
    <nav className="h-14 border-b bg-card flex items-center justify-between px-4 sticky top-0 z-50">
      <div className="flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">KT</span>
          </div>
          <span className="font-bold text-lg hidden sm:inline">KTrade Studio</span>
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Button
              key={item.path}
              variant="ghost"
              size="sm"
              className={cn(
                "h-9",
                isActive(item.path) && "bg-muted"
              )}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-64 hidden lg:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search symbols..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 bg-background"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery) {
                navigate(`/trade/${searchQuery.toUpperCase()}`);
                setSearchQuery('');
              }
            }}
          />
        </div>

        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Available</span>
          <span className="text-sm font-semibold">{formatCurrency(account.availableMargin)}</span>
        </div>

        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <User className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-semibold">{user?.name || 'Demo User'}</span>
                <span className="text-xs text-muted-foreground font-normal">{user?.email || 'demo@ktrade.test'}</span>
                <span className="text-xs text-muted-foreground font-normal mt-1">ID: {user?.id || 'demo-user-001'}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/portfolio')}>
              <Briefcase className="w-4 h-4 mr-2" />
              Portfolio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/watchlist')}>
              <Bookmark className="w-4 h-4 mr-2" />
              Watchlist
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
};
