import Link from "next/link";
import { Logo, PhotoBackdrop } from "@/components/ui";

// QR codes made before "continue on your phone" (#33) pointed here, so a
// computer tab left open from before that release still shows one. That old
// link only carries the photo-only token, which can't open the job, so explain
// how to get a working code instead of showing "Page not found" (#36).
export default function OldUploadLink() {
  return (
    <>
      <PhotoBackdrop photo="spanner" />
      <div className="lw-screen">
        <header className="lw-appbar">
          <Logo />
        </header>
        <main className="lw-screen__body pt-8">
          <h1 className="lw-title-1 px-2">This QR code is out of date</h1>
          <div className="lw-glass mt-6 space-y-4 p-[18px]">
            <p className="lw-callout text-muted text-pretty">
              Legwork was updated since that page was opened. Refresh the page on your computer, then scan the new QR code to carry on
              with your job here.
            </p>
            <Link href="/" className="lw-btn lw-btn--secondary w-full">
              Or start a new job on this phone
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}
