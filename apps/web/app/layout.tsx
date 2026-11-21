import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { preload } from "react-dom";
import "./globals.css";

// Inter is the web stand-in for SF Pro. Weights 300, 400, 600 and 700 only: never 500.
const inter = localFont({
  src: [
    { path: "./fonts/inter-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/inter-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/inter-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Legwork: find a tradie for the job",
  description: "Describe the job and we'll get it in front of the right tradies.",
  icons: { apple: "/brand/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  // Edge to edge on notched phones; the bars pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  // Android Chrome shrinks the page for the keyboard, so the composer and the
  // pinned pill stay above it. iOS Safari scrolls the focused field into view itself,
  // and pinned pills drop back into the page while a field has focus (styles/flow.css).
  interactiveWidget: "resizes-content",
};

// The tokens switch on [data-theme] (legwork-tokens.css). Follow the system
// setting, before first paint and whenever it changes.
const THEME_SCRIPT = `(function(){try{var m=matchMedia("(prefers-color-scheme: dark)"),d=document.documentElement;var s=function(){d.dataset.theme=m.matches?"dark":"light"};s();m.addEventListener("change",s)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The walking loader shows a second after someone starts a job; have it ready.
  preload("/legwork-loader.svg", { as: "image", type: "image/svg+xml" });
  return (
    <html lang="en" className={inter.variable} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="lw min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
