import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useEffect, useState } from "react";
import { WeatherProvider } from "../contexts/WeatherContext";

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1536);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1535px)");
    const update = () => setSidebarCollapsed(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const desktopNavigation = window.matchMedia("(min-width: 768px)");
    const closeMobileNavigation = () => {
      if (desktopNavigation.matches) setMobileNavigationOpen(false);
    };
    closeMobileNavigation();
    desktopNavigation.addEventListener("change", closeMobileNavigation);
    return () => desktopNavigation.removeEventListener("change", closeMobileNavigation);
  }, []);

  return (
    <WeatherProvider>
    <div className="flex h-dvh bg-slate-50 text-slate-900">
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} mobileOpen={mobileNavigationOpen} onMobileOpenChange={setMobileNavigationOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenNavigation={() => setMobileNavigationOpen(true)} navigationOpen={mobileNavigationOpen} />
        <main id="main-content" className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
    </WeatherProvider>
  );
}
