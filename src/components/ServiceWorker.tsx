"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that lets the timer open offline. Production
 * only: in development it would serve yesterday's code over today's.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    // After the page has loaded, so it never competes with what is on screen.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
