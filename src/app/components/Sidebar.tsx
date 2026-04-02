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

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
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
        <nav className="space-y-1 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-yellow-50 text-yellow-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="my-4 border-t"></div>

        <nav className="space-y-1 px-2">
          {secondaryItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-yellow-50 text-yellow-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
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
            © 2024 ILOILO CITY TRAFFIC MANAGEMENT OFFICE (ICTMO)
          </div>
        )}
      </div>
    </aside>
  );
}