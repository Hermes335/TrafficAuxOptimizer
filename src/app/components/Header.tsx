import { Clock, CloudRain, Bell, LogOut, User as UserIcon, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { fetchCurrentWeather, type WeatherCurrentSnapshot } from "../services/backend";

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherCurrentSnapshot | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000 * 30);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadWeather = () => {
      fetchCurrentWeather()
        .then((snapshot) => {
          if (!active) {
            return;
          }
          setWeather(snapshot);
        })
        .catch(() => {
          if (!active) {
            return;
          }
          setWeather(null);
        });
    };

    loadWeather();
    const timer = window.setInterval(loadWeather, 1000 * 60 * 5);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const manilaTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-PH", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Manila",
      }).format(now),
    [now],
  );

  const weatherLabel = useMemo(() => {
    if (!weather) {
      return "--°C - Weather unavailable";
    }
    const condition = weather.condition
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return `${Math.round(weather.temperature)}°C - ${condition}`;
  }, [weather]);

  const precipitationLabel = weather ? `${weather.precipitation.toFixed(1)}mm/hr precipitation` : "No live weather feed";

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    navigate("/login");
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!showUserMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".relative")) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showUserMenu]);

  return (
    <header className="flex items-center justify-between border-b bg-white px-6 py-3">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-400">
            <span className="text-lg font-bold text-white">⚡</span>
          </div>
          <span className="text-lg font-bold text-yellow-500">Traffic Deployment DSS</span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 rounded-lg border px-4 py-2">
          <Clock className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-gray-700">Manila: {manilaTimeLabel}</span>
        </div>

        <div className="flex items-center gap-2 rounded-lg border px-4 py-2">
          <CloudRain className="h-4 w-4 text-yellow-500" />
          <div>
            <div className="text-sm font-medium text-gray-900">{weatherLabel}</div>
            <div className="text-xs text-gray-500">{precipitationLabel}</div>
          </div>
        </div>

        <button className="relative">
          <Bell className="h-5 w-5 text-gray-600" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-400">
              <span className="text-sm font-bold text-white">
                {user?.username?.charAt(0).toUpperCase() || "U"}
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showUserMenu ? "rotate-180" : ""}`} />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-white py-1 shadow-lg">
              <div className="border-b px-4 py-3">
                <div className="text-sm font-medium text-gray-900">{user?.username}</div>
                <div className="text-xs text-gray-500">{user?.role}</div>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
