import { Clock, CloudRain, Bell } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchCurrentWeather, type WeatherCurrentSnapshot } from "../services/backend";

export function Header() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherCurrentSnapshot | null>(null);

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
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            3
          </span>
        </button>

        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-300">
          <img
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
            alt="User"
            className="h-full w-full rounded-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
