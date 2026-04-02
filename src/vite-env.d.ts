/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopConfig?: {
      backendUrl: string;
    };
  }
}

export {};
