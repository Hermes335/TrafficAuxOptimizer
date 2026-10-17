import { useAuth } from "../contexts/AuthContext";
import { NavLink, useMatch } from "react-router";
import {
  LayoutDashboard,
  CalendarRange,
  Zap,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Users,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

function SidebarNavLink({ item, collapsed, onNavigate }: { item: { icon: React.ComponentType<{ className?: string }>; label: string; path: string }; collapsed: boolean; onNavigate?: () => void }) {
  // A static class string survives Tooltip's asChild prop composition.
  const isActive = !!useMatch({ path: item.path, end: item.path === "/" });
  const link = (
    <NavLink
      to={item.path}
      aria-label={item.label}
      onClick={onNavigate}
      className={
        `transition-colors ${
          collapsed
            ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
            : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
        } ${
          isActive
            ? "bg-amber-50 font-semibold text-amber-900 ring-1 ring-inset ring-amber-200"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`
      }
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ collapsed, setCollapsed, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const { user } = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "administrator";
  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: CalendarRange, label: "Deployment Gantt", path: "/gantt-chart" },
    { icon: Zap, label: "Optimization", path: "/optimization" },
    { icon: AlertTriangle, label: "Incident Report", path: "/incident-report" },
    { icon: ClipboardCheck, label: "Review Reports", path: "/incident-review" },
  ];

  const secondaryItems = [
    { icon: Users, label: "Officer Management", path: "/officer-management" },
    { icon: Clock, label: "Audit Logs", path: "/audit-logs" },
    { icon: SettingsIcon, label: "System", path: "/settings" },
  ];

  const primaryItems = navItems.filter(item => canManage || item.path !== "/optimization");
  const visibleSecondaryItems = secondaryItems.filter(item => (canManage || item.path !== "/officer-management") && (user?.role === "administrator" || item.path !== "/audit-logs"));

  return (
    <>
    <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <SheetContent side="left" className="w-72 max-w-[85vw] gap-0" onCloseAutoFocus={event => {
        event.preventDefault();
        const opener = document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]');
        const desktopLink = document.querySelector<HTMLAnchorElement>('[aria-label="Primary navigation"] a[aria-current="page"]');
        (opener?.getClientRects().length ? opener : desktopLink)?.focus();
      }}>
        <SheetHeader>
          <SheetTitle>Traffic Deployment DSS</SheetTitle>
          <SheetDescription>Iloilo City operations</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="space-y-1 overflow-y-auto px-3 pb-6">
          {primaryItems.map(item => <SidebarNavLink key={item.path} item={item} collapsed={false} onNavigate={() => onMobileOpenChange(false)} />)}
          <div className="my-4 border-t" />
          {visibleSecondaryItems.map(item => <SidebarNavLink key={item.path} item={item} collapsed={false} onNavigate={() => onMobileOpenChange(false)} />)}
        </nav>
      </SheetContent>
    </Sheet>
    <aside
      aria-label="Primary navigation"
      className={`hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
        collapsed ? "w-16" : "w-52"
      }`}
    >
      <div className="flex-1 overflow-y-auto py-4">
        <nav className={`space-y-1 ${collapsed ? "px-1" : "px-2"}`}>
          {primaryItems.map((item) => (
            <SidebarNavLink key={item.path} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="my-4 border-t"></div>

        <nav className={`space-y-1 ${collapsed ? "px-1" : "px-2"}`}>
          {visibleSecondaryItems.map((item) => (
            <SidebarNavLink key={item.path} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </div>

      <div className="border-t p-2">
        <button
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed(!collapsed)}
          className={`transition-colors ${
            collapsed
              ? "mx-auto grid h-10 w-10 place-items-center rounded-lg text-gray-700 hover:bg-gray-100"
              : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
          }`}
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <>
              <ChevronLeft className="h-5 w-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
        {!collapsed && (
          <div className="mt-4 px-3 text-xs text-gray-500">
            © 2024-2026 Iloilo City Traffic Management Office (ICTMO)
          </div>
        )}
      </div>
    </aside>
    </>
  );
}
