import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl, validateHostedApiUrl } from "../app/services/apiConfig";
import { buildWebSocketUrl } from "../app/services/backend";

afterEach(() => vi.unstubAllEnvs());

describe("hosted frontend configuration", () => {
  it("normalizes an HTTPS backend origin", () => {
    expect(validateHostedApiUrl(" https://traffic-api.example.com/ ")).toBe("https://traffic-api.example.com");
  });

  it.each([
    undefined, "", "not a URL", "http://api.example.com", "https://localhost",
    "https://127.0.0.1", "https://[::1]", "https://192.168.1.10",
    "https://10.0.0.1", "https://172.16.0.1", "https://api.example.com/api",
    "https://api.example.com?key=secret", "https://user:password@api.example.com",
    "https://api.example.com/#fragment",
  ])("rejects an unusable hosted API origin (%s)", value => {
    expect(() => resolveApiBaseUrl(value, undefined, true)).toThrow(/VITE_API_BASE_URL/);
  });

  it("preserves local and Electron configuration", () => {
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:8000");
    expect(resolveApiBaseUrl("http://localhost:8001/")).toBe("http://localhost:8001");
    expect(resolveApiBaseUrl(undefined, "http://127.0.0.1:9000/")).toBe("http://127.0.0.1:9000");
  });

  it("uses secure WebSockets on the hosted backend", () => {
    vi.stubEnv("MODE", "web");
    vi.stubEnv("VITE_API_BASE_URL", "https://traffic-api.example.com");
    const url = new URL(buildWebSocketUrl("/ws/dashboard/", "fixture-token"));
    expect(url.origin).toBe("wss://traffic-api.example.com");
    expect(url.pathname).toBe("/ws/dashboard/");
  });
});
