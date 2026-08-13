/// <reference types="vite/client" />

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "maplibre-gl/dist/maplibre-gl.css";

declare global {
  interface Window {
    desktopConfig?: {
      backendUrl: string;
    };
  }
}

export {};
