import { Search, LogOut, Shield } from "lucide-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function TopNav() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/admin/login");
  };

  return (
    <header className="h-14 border-b border-border bg-background-elevated flex items-center justify-between px-6">
      {/* Left: Platform Name */}
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-semibold text-foreground tracking-tight">
          MARKET SENTINEL
        </span>
        <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 bg-secondary rounded">
          ADMIN
        </span>
      </div>

      {/* Center: Global Search */}
      <div className="flex-1 max-w-md mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search symbols, instruments, data..."
            className="pl-10 bg-secondary border-border-subtle text-sm h-9"
          />
        </div>
      </div>

      {/* Right: Admin Info + Logout */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex flex-col items-end">
            <span className="data-label">Admin</span>
            <span className="data-value">{admin?.username}</span>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex flex-col items-end">
            <span className="data-label">ID</span>
            <span className="data-value font-mono text-xs">{admin?.adminId}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </header>
  );
}
