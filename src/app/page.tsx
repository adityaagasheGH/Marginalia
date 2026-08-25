import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * Landing page. If already signed in, skip straight to the dashboard;
 * otherwise show the value proposition and the two entry points.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-4 text-center">
      <h1 className="font-serif text-5xl tracking-tight text-ink">Marginalia</h1>
      <p className="mt-4 max-w-md text-lg text-ink-muted">
        Upload a PDF, get an AI summary, ask it questions, and argue about it in
        the margins.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/signup">Get started</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </main>
  );
}
