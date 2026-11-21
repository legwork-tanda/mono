import Link from "next/link";
import { Logo } from "@/components/ui";

// QR codes made before "continue on your phone" (#33) pointed here, so a
// computer tab left open from before that release still shows one. That old
// link only carries the photo-only token, which can't open the job, so explain
// how to get a working code instead of showing "Page not found" (#36).
export default function OldUploadLink() {
  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
        <Logo />
        <div className="mt-10 space-y-3 rounded-2xl border border-line bg-white p-5">
          <h1 className="text-xl font-semibold">This QR code is out of date</h1>
          <p className="text-muted text-pretty">
            Legwork was updated since that page was opened. Refresh the page on your computer, then scan the new QR code to carry on
            with your job here.
          </p>
          <Link href="/" className="inline-block font-semibold text-brand underline underline-offset-2">
            Or start a new job on this phone
          </Link>
        </div>
      </main>
    </div>
  );
}
