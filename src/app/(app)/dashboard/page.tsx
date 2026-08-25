import { auth } from "@/auth";
import { LogoutButton } from "@/components/auth/logout-button";

/**
 * Placeholder dashboard. Middleware already guarantees a session before this
 * renders, but we read it here to greet the user by name. The real dashboard
 * (document grid, upload, search) arrives in Day 1 Evening.
 *
 * This is a Server Component: `auth()` runs on the server, so the session is
 * available without any client-side fetch.
 */
export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex items-center justify-between border-b border-rule bg-surface px-6 py-4">
        <span className="font-serif text-xl text-ink">Marginalia</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-muted">{session?.user?.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h1 className="font-serif text-3xl text-ink">
          Welcome, {session?.user?.name ?? "reader"}.
        </h1>
        <p className="mt-3 text-ink-muted">
          Your documents will live here. Upload and reading come next.
        </p>
      </div>
    </main>
  );
}
