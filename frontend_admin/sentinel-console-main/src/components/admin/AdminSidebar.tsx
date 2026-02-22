import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  History,
  Brain,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Market Data",
    href: "/admin/market-data",
    icon: BarChart3,
  },
  {
    title: "Order Book Monitoring",
    href: "/admin/order-book",
    icon: BookOpen,
  },
  {
    title: "Trade History",
    href: "/admin/trade-history",
    icon: History,
  },
  {
    title: "ML Model Pipeline",
    href: "/admin/ml-model",
    icon: Brain,
  },
  {
    title: "AI Market Surveillance",
    href: "/admin/surveillance",
    icon: ScanSearch,
  },
];

export function AdminSidebar() {
  const location = useLocation();

  return (
    <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col">
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <li key={item.href}>
                <NavLink
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className={cn("h-4 w-4", isActive && "text-sidebar-primary")} />
                  {item.title}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-muted-foreground">
          <p>Market Sentinel v1.0</p>
          <p className="mt-1">Surveillance Active</p>
        </div>
      </div>
    </aside>
  );
}
