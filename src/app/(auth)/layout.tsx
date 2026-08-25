import Link from "next/link";

/**
 * Shared shell for /login and /signup: a centred column on paper, with the
 * wordmark above the card. The (auth) folder is a route group — the
 * parentheses mean it groups these pages under this layout without adding
 * "auth" to the URL.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Link
          href="/"
          className="mb-8 block text-center font-serif text-3xl tracking-tight text-ink"
        >
          Marginalia
        </Link>
        {children}
        <p className="mt-8 text-center text-xs text-ink-muted">
          Read it. Ask it. Argue about it.
        </p>
      </div>
    </main>
  );
}
