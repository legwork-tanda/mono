import Link from "next/link";
import { Logo, PhotoBackdrop } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PhotoBackdrop photo="spanner" />
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
