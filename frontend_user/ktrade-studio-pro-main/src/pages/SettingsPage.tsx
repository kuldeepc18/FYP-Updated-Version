import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { resetDemo, setTheme } from '@/store/tradingSlice';
import { orderService } from '@/services';
import { toast } from 'sonner';
import { RefreshCw, Moon, Sun, Shield, Wallet } from 'lucide-react';

const SettingsPage = () => {
  const dispatch = useAppDispatch();
  const { account, theme } = useAppSelector((state) => state.trading);
  const { user } = useAppSelector((state) => state.auth);
  
  const [virtualBalance, setVirtualBalance] = useState(account.balance.toString());

  const handleResetDemo = () => {
    dispatch(resetDemo());
    toast.success('Demo account reset successfully');
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    dispatch(setTheme(newTheme));
    document.documentElement.classList.toggle('dark');
    toast.success(`Switched to ${newTheme} mode`);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your account and preferences</p>
      </div>

      {/* Account Info */}
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Account Information</h2>
            <p className="text-sm text-muted-foreground">Your account details</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-xs">Username</Label>
              <p className="font-medium">{user?.name || 'Demo User'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">User ID</Label>
              <p className="font-medium font-mono text-sm">{user?.id || 'demo-user-001'}</p>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs">Email</Label>
            <p className="font-medium">{user?.email || 'demo@ktrade.test'}</p>
          </div>
        </div>
      </Card>

      {/* Paper Trading Settings */}
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-muted">
            <Wallet className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Paper Trading</h2>
            <p className="text-sm text-muted-foreground">Demo account settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-muted-foreground text-xs">Current Balance</Label>
            <p className="text-2xl font-bold">{formatCurrency(account.balance)}</p>
          </div>

          <Separator />

          <div>
            <Label className="text-muted-foreground text-xs">Available Margin</Label>
            <p className="text-lg font-semibold">{formatCurrency(account.availableMargin)}</p>
          </div>

          <Separator />

          <div>
            <Button 
              variant="destructive" 
              onClick={handleResetDemo}
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset Demo Account
            </Button>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              This will reset your balance to ₹5,00,000 and clear all orders & positions
            </p>
          </div>
        </div>
      </Card>

      {/* Appearance */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-muted">
            {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">Customize the look and feel</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Dark Mode</p>
            <p className="text-sm text-muted-foreground">Toggle between light and dark theme</p>
          </div>
          <Switch 
            checked={theme === 'dark'}
            onCheckedChange={toggleTheme}
          />
        </div>
      </Card>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-muted-foreground">
        <p>© 2025 KTrade Studio — Demo & Educational Use Only</p>
      </div>
    </div>
  );
};

export default SettingsPage;
