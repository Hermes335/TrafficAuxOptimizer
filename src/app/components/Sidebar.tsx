import { NavLink } from "react-router";
import {
  LayoutDashboard,
  CalendarRange,
  Zap,
  FlaskConical,
  AlertTriangle,
  BarChart3,
  Clock,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

function SidebarNavLink({ item, collapsed }: { item: { icon: React.ComponentType<{ className?: string }>; label: string; path: string }; collapsed: boolean }) {
  const link = (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `transition-colors ${
          collapsed
            ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
            : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
        } ${
          isActive
            ? "bg-yellow-50 text-yellow-600"
            : "text-gray-700 hover:bg-gray-100"
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

export function Sidebar({ collapsed, setCollapsed }: SidebarProps) {
  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: CalendarRange, label: "Gantt Chart", path: "/gantt-chart" },
    { icon: Zap, label: "Optimization", path: "/optimization" },
    { icon: FlaskConical, label: "Scenarios", path: "/scenarios" },
    { icon: AlertTriangle, label: "Incident Report", path: "/incident-report" },
  ];

  const secondaryItems = [
    { icon: BarChart3, label: "Analytics", path: "/analytics" },
    { icon: Clock, label: "Audit Logs", path: "/audit-logs" },
    { icon: SettingsIcon, label: "System", path: "/settings" },
  ];

  return (
    <aside
      className={`flex flex-col border-r bg-white transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex-1 overflow-y-auto py-4">
        <nav className={`space-y-1 ${collapsed ? "px-1" : "px-2"}`}>
          {navItems.map((item) => (
            <SidebarNavLink key={item.path} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="my-4 border-t"></div>

        <nav className={`space-y-1 ${collapsed ? "px-1" : "px-2"}`}>
          {secondaryItems.map((item) => (
            <SidebarNavLink key={item.path} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </div>

      <div className="border-t p-2">
        <button
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
  );
}
