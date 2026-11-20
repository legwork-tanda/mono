import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { preload } from "react-dom";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: "Legwork: find a tradie for the job",
  description: "Describe the job and we'll get it in front of the right tradies.",
};

export const viewport: Viewport = {
  themeColor: "#f5f7fb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The walking loader shows a second after someone starts a job; have it ready.
  preload("/legwork-loader.svg", { as: "image", type: "image/svg+xml" });
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-dvh bg-white font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
