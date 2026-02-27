import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search, User, LogOut, Settings, Moon, Sun,
  LayoutDashboard, Bookmark, Briefcase, PlusCircle, MinusCircle,
} from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setTheme } from '@/store/tradingSlice';
import { clearAuth, updateUserBalance } from '@/store/authSlice';
import { authService } from '@/services/auth';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export const TopNav = () => {
  const navigate           = useNavigate();
  const location           = useLocation();
  const dispatch           = useAppDispatch();
  const { user }           = useAppSelector((state) => state.auth);
  const { account, theme } = useAppSelector((state) => state.trading);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Add Balance dialog state ─────────────────────────────────────────────
  const [addOpen,    setAddOpen]    = useState(false);
  const [addAmount,  setAddAmount]  = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // ── Withdraw Balance dialog state ────────────────────────────────────────
  const [wdOpen,    setWdOpen]    = useState(false);
  const [wdAmount,  setWdAmount]  = useState('');
  const [wdLoading, setWdLoading] = useState(false);

  // Real balance from auth store (kept up-to-date by updateUserBalance action)
  const displayBalance = user?.balance ?? account.balance;

  const handleLogout = async () => {
    await authService.logout();
    dispatch(clearAuth());
    navigate('/auth/login');
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    dispatch(setTheme(newTheme)); // reducer handles localStorage + DOM class
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);

  const handleAddMoney = async () => {
    const n = parseFloat(addAmount);
    if (!n || n <= 0) { toast.error('Please enter a valid positive amount'); return; }
    setAddLoading(true);
    try {
      const result = await authService.addBalance(n);
      dispatch(updateUserBalance(result.balance));
      toast.success(`₹${n.toLocaleString('en-IN')} added successfully!`);
      setAddOpen(false);
      setAddAmount('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add balance');
    } finally {
      setAddLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const n = parseFloat(wdAmount);
    if (!n || n <= 0) { toast.error('Please enter a valid positive amount'); return; }
    setWdLoading(true);
    try {
      const result = await authService.withdrawBalance(n);
      dispatch(updateUserBalance(result.balance));
      toast.success(`₹${n.toLocaleString('en-IN')} withdrawn successfully!`);
      setWdOpen(false);
      setWdAmount('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to withdraw balance');
    } finally {
      setWdLoading(false);
    }
  };

  const navItems = [
    { path: '/',          label: 'Dashboard', icon: LayoutDashboard },
    { path: '/trade',     label: 'Trade',     icon: null },
    { path: '/watchlist', label: 'Watchlist', icon: Bookmark },
    { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
  ];

  const isActive = (path: string) => {
    if (path === '/trade') return location.pathname.startsWith('/trade');
    return location.pathname === path;
  };

  return (
    <>
      <nav className="h-14 border-b bg-card flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">KT</span>
            </div>
            <span className="font-bold text-lg hidden sm:inline">KTrade Studio</span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Button
                key={item.path}
                variant="ghost"
                size="sm"
                className={cn('h-9', isActive(item.path) && 'bg-muted')}
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

          {/* Live balance chip */}
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-xs text-muted-foreground">Balance</span>
            <span className="text-sm font-semibold">{formatCurrency(displayBalance)}</span>
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
            <DropdownMenuContent align="end" className="w-60 bg-popover">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{user?.name || 'User'}</span>
                  <span className="text-xs text-muted-foreground font-normal">{user?.email}</span>
                  <span className="text-xs font-semibold text-primary mt-1">
                    {formatCurrency(displayBalance)}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => { setAddAmount(''); setAddOpen(true); }}
                className="cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 mr-2 text-green-500" />
                Add Balance
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => { setWdAmount(''); setWdOpen(true); }}
                className="cursor-pointer"
              >
                <MinusCircle className="w-4 h-4 mr-2 text-red-500" />
                Withdraw Balance
              </DropdownMenuItem>

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

      {/* ── Add Balance Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Balance</DialogTitle>
            <DialogDescription>
              Current balance: <strong>{formatCurrency(displayBalance)}</strong>
              <br />
              Enter the amount you want to add to your trading account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="add-amount">Amount (₹)</Label>
            <Input
              id="add-amount"
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 10000"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMoney()}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addLoading}>
              Cancel
            </Button>
            <Button onClick={handleAddMoney} disabled={addLoading || !addAmount}>
              {addLoading ? 'Adding…' : 'Add Money'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw Balance Dialog ─────────────────────────────────────────── */}
      <Dialog open={wdOpen} onOpenChange={setWdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw Balance</DialogTitle>
            <DialogDescription>
              Available balance: <strong>{formatCurrency(displayBalance)}</strong>
              <br />
              Enter the amount you want to withdraw. Cannot exceed available balance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="wd-amount">Amount (₹)</Label>
            <Input
              id="wd-amount"
              type="number"
              min="1"
              step="any"
              max={displayBalance}
              placeholder={`Max ₹${displayBalance.toLocaleString('en-IN')}`}
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWithdraw()}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWdOpen(false)} disabled={wdLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleWithdraw}
              disabled={wdLoading || !wdAmount}
            >
              {wdLoading ? 'Withdrawing…' : 'Withdraw Money'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
