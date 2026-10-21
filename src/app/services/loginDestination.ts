import type { UserRole } from "../contexts/AuthContext";

// Keep return destinations aligned with the guarded pages in routes.tsx. Only
// known app pages can be restored, even when the login state came from a link.
const pageRoles: Record<string, readonly UserRole[]> = {
  "/": ["dispatcher", "supervisor", "administrator"],
  "/gantt-chart": ["dispatcher", "supervisor", "administrator"],
  "/optimization": ["supervisor", "administrator"],
  "/optimization-engine": ["dispatcher", "supervisor", "administrator"],
  "/optimization-running": ["supervisor", "administrator"],
  "/component-library": ["dispatcher", "supervisor", "administrator"],
  "/incident-report": ["dispatcher", "supervisor", "administrator"],
  "/incident-review": ["dispatcher", "supervisor", "administrator"],
  "/officer-management": ["supervisor", "administrator"],
  "/audit-logs": ["administrator"],
  "/settings": ["dispatcher", "supervisor", "administrator"],
};

export function loginDestination(state: unknown, role?: UserRole): string {
  if (!role || !state || typeof state !== "object" || !("from" in state)) return "/";
  const from = state.from;
  let candidate: string;
  if (typeof from === "string") {
    candidate = from;
  } else if (from && typeof from === "object" && "pathname" in from && typeof from.pathname === "string") {
    const search = "search" in from ? from.search : "";
    const hash = "hash" in from ? from.hash : "";
    if (typeof search !== "string" || typeof hash !== "string" ||
        (search !== "" && !search.startsWith("?")) || (hash !== "" && !hash.startsWith("#"))) return "/";
    candidate = from.pathname + search + hash;
  } else return "/";

  if (!candidate.startsWith("/") || candidate.startsWith("//") || /[\\\u0000-\u0020]/.test(candidate)) return "/";
  try {
    const url = new URL(candidate, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return "/";
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
    const roles = /^\/incident-report\/[^/]+$/.test(path) ? pageRoles["/incident-report"] : pageRoles[path];
    return roles?.includes(role) ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
