import { auth } from "@/auth";
import { LogoutButton } from "@/components/auth/logout-button";
import { DocumentsView } from "@/components/dashboard/documents-view";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Dashboard: upload PDFs and see them processed. Middleware guarantees a
 * session before this renders; we read it to greet the user.
 */
export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex items-center justify-between border-b border-rule bg-surface px-6 py-4">
        <span className="font-serif text-xl text-ink">Marginalia</span>
        {/* Right cluster: email + logout on top, theme toggle beneath. */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {session?.user?.email}
            </span>
            <LogoutButton />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <h1 className="font-serif text-2xl text-ink">Your documents</h1>
          <p className="text-sm text-ink-muted">
            Upload a PDF to get an AI summary and chat.
          </p>
        </div>
        <DocumentsView />
      </div>
    </main>
  );
}
