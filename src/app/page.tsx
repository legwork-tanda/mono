import { DemoUserMissingError, type HomeView } from "@/lib/job-service";
import { getJobService } from "@/lib/server/job-service";
import { MissingEnvError } from "@/lib/supabase/server";

// Always render on request: the data lives in Supabase, not in the build.
export const dynamic = "force-dynamic";

type HomeResult = { ok: true; home: HomeView } | { ok: false; problem: string };

async function loadHome(): Promise<HomeResult> {
  try {
    return { ok: true, home: await getJobService().getHome() };
  } catch (error) {
    if (error instanceof MissingEnvError || error instanceof DemoUserMissingError) {
      return { ok: false, problem: error.message };
    }
    throw error;
  }
}

export default async function HomePage() {
  const result = await loadHome();

  if (!result.ok) {
    return (
      <main className="screen">
        <h1>Almost there</h1>
        <p>The app isn&apos;t connected to its database yet.</p>
        <p className="notice">{result.problem}</p>
        <p>Follow &ldquo;Running locally&rdquo; in the README, then refresh this page.</p>
      </main>
    );
  }

  const { user, homeAddress } = result.home;
  return (
    <main className="screen">
      <p className="muted">Signed in</p>
      <h1>Hi {user.name.split(" ")[0]}</h1>
      <section className="card">
        <p className="muted">Home</p>
        <p>{homeAddress.label}</p>
      </section>
      <button className="primary" disabled>
        Report a problem
      </button>
      <p className="muted small">Coming soon: take a photo and get a price in a minute.</p>
    </main>
  );
}
