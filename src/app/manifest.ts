import type { MetadataRoute } from "next";

/**
 * What makes cubeduel installable: "Add to Home Screen" on a phone, "Install
 * app" in desktop Chrome. It then opens on its own, full screen, straight to
 * the timer — the page people come back for — with its own icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "cubeduel — speedcubing that shows you why you're slow",
    short_name: "cubeduel",
    description:
      "A free speedcubing timer, trainer and solver. Every solve reviewed move by move; works offline once visited.",
    start_url: "/timer",
    scope: "/",
    display: "standalone",
    background_color: "#0e1320",
    theme_color: "#0e1320",
    categories: ["games", "sports", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Timer", url: "/timer" },
      { name: "Keyboard", url: "/play" },
      { name: "Train", url: "/train" },
    ],
  };
}
