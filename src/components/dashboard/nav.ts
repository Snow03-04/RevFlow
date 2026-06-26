import {
  LayoutDashboard,
  Package,
  Megaphone,
  Plug,
  Settings,
  TableProperties,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/products", icon: Package },
  { label: "Ads", href: "/ads", icon: Megaphone },
  { label: "P&L Sheet", href: "/pnl", icon: TableProperties },
  { label: "ROAS Tracker", href: "/roas", icon: TrendingUp },
  { label: "Connections", href: "/connections", icon: Plug },
  { label: "Settings", href: "/settings", icon: Settings },
];
