import {
  LayoutDashboard,
  Package,
  Megaphone,
  Plug,
  Settings,
  TableProperties,
  TrendingUp,
  Coins,
  Telescope,
  Store,
  Truck,
  ListChecks,
  Search,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  { label: "Visão geral", items: [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ] },
  { label: "Finance", items: [
  { label: "P&L Sheet", href: "/pnl", icon: TableProperties },
  { label: "General sheet", href: "/finance/general", icon: TableProperties },
  { label: "Meta", href: "/finance/meta", icon: Megaphone },
  { label: "Google", href: "/finance/google", icon: Search },
  { label: "ROAS Tracker", href: "/roas", icon: TrendingUp },
  ] },
  { label: "Operações", items: [
  { label: "Products", href: "/products", icon: Package },
  { label: "Custos (COGS)", href: "/costs", icon: Coins },
  { label: "Fornecedor", href: "/supplier", icon: Truck },
  { label: "Auditoria COGS", href: "/cogs-audit", icon: ListChecks },
  { label: "Ads", href: "/ads", icon: Megaphone },
  ] },
  { label: "Research", items: [
  { label: "Product Research", href: "/research", icon: Telescope },
  { label: "Store Research", href: "/stores", icon: Store },
  ] },
  { label: "App", items: [
  { label: "Connections", href: "/connections", icon: Plug },
  { label: "Settings", href: "/settings", icon: Settings },
  ] },
];
