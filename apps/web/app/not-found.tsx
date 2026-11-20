import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-24">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="underline">Go home</Link>
    </main>
  );
}
