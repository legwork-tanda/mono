"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Walking } from "@/components/ui";

/** Old tradie routes (Offers, My jobs, one offer) now live on the dashboard. */
export function ToHome() {
  const router = useRouter();
  useEffect(() => router.replace("/tradie/home/"), [router]);
  return (
    <div className="lw-screen items-center justify-center">
      <Walking label="Opening your dashboard…" />
    </div>
  );
}
