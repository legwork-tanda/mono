import Link from "next/link";
import { Logo, PhotoBackdrop } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      {/* Lazy: Next renders this page with every route, and an eager image is preloaded (and unused) on each. */}
      <PhotoBackdrop photo="spanner" lazy />
      <div className="lw-screen">
        <header className="lw-appbar">
          <Logo />
        </header>
        <main className="lw-screen__body justify-center gap-6 pb-[20vh]">
          <h1 className="lw-title-1 px-2">Page not found</h1>
          <Link href="/" className="lw-btn">
            Go home
          </Link>
        </main>
      </div>
    </>
  );
}
