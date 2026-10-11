/** Public frontend configuration only. Backend credentials never belong here. */
export function validateHostedApiUrl(value?: string): string {
  if (!value?.trim()) {
    throw new Error("Set VITE_API_BASE_URL to your hosted Django HTTPS origin before building for Vercel (for example https://api.your-domain.com). See DEPLOYMENT_VERCEL.md.");
  }
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("VITE_API_BASE_URL must be an absolute HTTPS URL."); }
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host === "[::1]" || host === "[::]" || /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (url.protocol !== "https:" || privateHost) {
    throw new Error("VITE_API_BASE_URL must use HTTPS and a publicly reachable backend hostname, not a local address.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("VITE_API_BASE_URL must contain only the backend origin. Remove /api, paths, credentials, queries, and fragments.");
  }
  return url.origin;
}

export function resolveApiBaseUrl(configuredUrl?: string, desktopUrl?: string, hosted = false): string {
  if (desktopUrl) return desktopUrl.replace(/\/+$/, "");
  if (hosted) return validateHostedApiUrl(configuredUrl);
  return configuredUrl?.replace(/\/+$/, "") || "http://127.0.0.1:8000";
}
