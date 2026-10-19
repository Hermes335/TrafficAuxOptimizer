import { Clock, LogOut, ChevronDown, Menu, Route } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { WeatherStatus } from "./WeatherStatus";

export function Header({ onOpenNavigation, navigationOpen }: { onOpenNavigation: () => void; navigationOpen: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const outside = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setShowUserMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUserMenu(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [showUserMenu]);

  const manilaTime = new Intl.DateTimeFormat("en-PH", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila",
  }).format(now);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onOpenNavigation} aria-label="Open navigation" aria-expanded={navigationOpen} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <div className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-400 text-slate-950 md:grid"><Route className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">TrafficOffOptimizer</div>
          <div className="text-xs text-slate-500">Iloilo City operations</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <div className="hidden items-center gap-2 text-xs text-slate-600 lg:flex"><Clock className="h-4 w-4" /><span>Manila <span className="font-semibold tabular-nums text-slate-900">{manilaTime}</span></span></div>
        <div className="hidden border-l border-slate-200 pl-5 sm:block"><WeatherStatus compact /></div>
        <div className="relative" ref={accountRef}>
          <button ref={accountButtonRef} aria-label="Account menu" aria-expanded={showUserMenu} aria-controls="account-menu" onClick={() => setShowUserMenu(value => !value)} className="flex min-h-10 items-center gap-1.5 rounded-lg px-1.5 hover:bg-slate-100">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{user?.username?.charAt(0).toUpperCase() || "U"}</span>
            <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${showUserMenu ? "rotate-180" : ""}`} />
          </button>
          {showUserMenu && <div id="account-menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b px-4 py-3"><div className="text-sm font-semibold">{user?.username}</div><div className="text-xs capitalize text-slate-600">{user?.role}</div></div>
            <div className="space-y-3 border-b px-4 py-3 sm:hidden"><div className="text-xs text-slate-600">Manila time · {manilaTime}</div><WeatherStatus /></div>
            <button onClick={async () => { setShowUserMenu(false); await logout(); navigate("/login"); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50"><LogOut className="h-4 w-4" />Sign Out</button>
          </div>}
        </div>
      </div>
    </header>
  );
}
