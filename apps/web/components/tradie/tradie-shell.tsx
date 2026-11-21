"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon, PhotoBackdrop, Walking } from "@/components/ui";
import { OfferTakeover } from "./offer-takeover";
import { TradieProvider, useTradie } from "./tradie-context";

/**
 * Around every tradie page: the blurred photo, the sign-in guard, the toast,
 * and the job offer that takes over the screen when one comes in. No tab bar:
 * the dashboard is home (legwork-tradie v0.1, T01).
 */
export function TradieShell({ children }: { children: React.ReactNode }) {
  return (
    <TradieProvider>
      <Frame>{children}</Frame>
    </TradieProvider>
  );
}

const norm = (path: string) => path.replace(/\/+$/, "") || "/";

function Frame({ children }: { children: React.ReactNode }) {
  const { session, toast } = useTradie();
  const path = norm(usePathname());
  const router = useRouter();
  const onSignUp = path === "/tradie";

  // Every page but sign-up needs a tradie signed in on this phone.
  useEffect(() => {
    if (session === null && !onSignUp) router.replace("/tradie/");
  }, [session, onSignUp, router]);

  const signedIn = !!session && !onSignUp;

  return (
    <>
      <PhotoBackdrop photo="spanner" position="50% 45%" />
      {session === undefined || (session === null && !onSignUp) ? (
        <div className="lw-screen items-center justify-center">
          <Walking label="Loading…" />
        </div>
      ) : (
        children
      )}
      {signedIn && <OfferTakeover />}
      {toast && (
        <div key={toast.id} role="status" className="lw-glass lw-toast">
          <Icon name={toast.icon} />
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}
