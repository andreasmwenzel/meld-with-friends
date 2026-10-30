import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Albert_Sans } from "next/font/google";
import "./globals.css";
import { CLOTH_SCRIPT } from "@/lib/look";

const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
});

const albert = Albert_Sans({
  variable: "--font-albert",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meld — pinochle with your friends",
  description:
    "Pull up a chair. Meld is a free online card table for pinochle: invite friends with a short code, pick your seats, and play in real time.",
  appleWebApp: { capable: true, title: "Meld", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// No themeColor here: the cloth script writes the theme-color tag itself, in the chosen cloth. A tag rendered by React
// would come back in oxblood beside it on hydration.
export const viewport: Viewport = {};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The cloth script sets data-cloth on <html> before React hydrates, so the attribute is expected to differ.
    <html lang="en" className={`${bodoni.variable} ${albert.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CLOTH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
