"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Avatar } from "@/components/match-view";
import { Logo, Walking } from "@/components/ui";
import { TradieProvider, useTradie } from "./tradie-context";

/** The phone-sized frame around every tradie page: header, the page, and the tab bar. */
export function TradieShell({ children }: { children: React.ReactNode }) {
  return (
    <TradieProvider>
      <Frame>{children}</Frame>
    </TradieProvider>
  );
}

const norm = (path: string) => path.replace(/\/+$/, "") || "/";

function Frame({ children }: { children: React.ReactNode }) {
  const { session, inbox, bookings } = useTradie();
  const path = norm(usePathname());
  const router = useRouter();
  const onSignUp = path === "/tradie";

  // Every page but sign-up needs a tradie signed in on this phone.
  useEffect(() => {
    if (session === null && !onSignUp) router.replace("/tradie/");
  }, [session, onSignUp, router]);

  const pending = inbox?.offers.filter((o) => o.state === "pending").length ?? 0;
  const unread = bookings?.unread ?? 0;
  const active = bookings?.bookings.filter((b) => b.stage === "matched" || b.stage === "en_route" || b.stage === "in_progress").length ?? 0;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            {/* Stays in the tradie view: offers when signed in, sign-up otherwise. */}
            <Logo href={session ? "/tradie/inbox/" : "/tradie/"} />
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">Tradie</span>
          </div>
          {session && (
            <Link href="/tradie/me/" className="flex items-center gap-2 rounded-full py-1 pr-1 pl-3 hover:bg-surface" aria-label="Your profile">
              <span className="max-w-[9rem] truncate text-sm font-semibold">{session.tradie.username}</span>
              <Avatar
                tradie={{ id: session.tradie.id, name: session.tradie.username, business: session.tradie.business, rating: session.tradie.rating, reviewCount: session.tradie.reviewCount, jobsDone: session.tradie.jobsDone, reviews: [] }}
                size="size-8"
              />
            </Link>
          )}
        </div>
      </header>

      <main className={`mx-auto w-full max-w-md px-4 pt-5 ${session && !onSignUp ? "pb-28" : "pb-10"}`}>
        {session === undefined || (session === null && !onSignUp) ? <Walking label="Loading…" className="mt-6" /> : children}
      </main>

      {session && !onSignUp && (
        <nav aria-label="Tradie" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto grid max-w-md grid-cols-2">
            <Tab href="/tradie/inbox/" label="Offers" active={path.startsWith("/tradie/inbox") || path.startsWith("/tradie/offer")} badge={pending} />
            <Tab href="/tradie/jobs/" label="My jobs" active={path.startsWith("/tradie/jobs") || path.startsWith("/tradie/job")} badge={unread || active} dot={unread > 0} />
          </div>
        </nav>
      )}
    </div>
  );
}

function Tab({ href, label, active, badge, dot }: { href: string; label: string; active: boolean; badge: number; dot?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-16 flex-col items-center justify-center gap-0.5 text-sm font-semibold transition-colors ${active ? "text-brand" : "text-muted hover:text-ink"}`}
    >
      <span>{label}</span>
      {badge > 0 && (
        <span
          className={`absolute top-2.5 left-[calc(50%+1.75rem)] flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${dot ? "bg-danger" : "bg-brand"}`}
          aria-label={`${badge} ${dot ? "unread" : "new"}`}
        >
          {badge}
        </span>
      )}
      {active && <span className="absolute inset-x-8 top-0 h-0.5 rounded-full bg-brand" aria-hidden />}
    </Link>
  );
}
