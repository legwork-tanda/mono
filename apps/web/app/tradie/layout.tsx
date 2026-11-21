import type { Metadata } from "next";
import { TradieShell } from "@/components/tradie/tradie-shell";

export const metadata: Metadata = {
  title: "Legwork for tradies",
  description: "Pre-priced job offers near you. No lead fees.",
};

export default function TradieLayout({ children }: { children: React.ReactNode }) {
  return <TradieShell>{children}</TradieShell>;
}
