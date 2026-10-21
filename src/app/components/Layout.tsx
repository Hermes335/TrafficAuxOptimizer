import { usePageState } from "../contexts/PageStateContext";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useEffect, useState } from "react";
import { WeatherProvider } from "../contexts/WeatherContext";

export function Layout() {
  const [sidebarPreference, setSidebarPreference] = usePageState<boolean | null>("layout.sidebarCollapsed", null);
  const [compactNavigation, setCompactNavigation] = useState(() => window.innerWidth < 1280);
  const sidebarCollapsed = sidebarPreference ?? compactNavigation;
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setCompactNavigation(!query.matches);
    update();
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
      <a href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }} className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg focus:translate-y-0">Skip to main content</a>
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarPreference} mobileOpen={mobileNavigationOpen} onMobileOpenChange={setMobileNavigationOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenNavigation={() => setMobileNavigationOpen(true)} navigationOpen={mobileNavigationOpen} />
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-auto focus:outline-none">
          <Outlet />
        </main>
      </div>
    </div>
    </WeatherProvider>
  );
}
