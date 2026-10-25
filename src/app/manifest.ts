import type { MetadataRoute } from "next";

const CLOTH = "#5b1d25";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meld",
    short_name: "Meld",
    description:
      "Pull up a chair. Meld is a free online card table for pinochle: invite friends with a short code, pick your seats, and play in real time.",
    start_url: "/home",
    display: "standalone",
    background_color: CLOTH,
    theme_color: CLOTH,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
