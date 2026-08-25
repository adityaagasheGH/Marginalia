"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupSchema } from "@/lib/validation";

/**
 * Signup form (client component — it needs browser interactivity for field
 * state, inline errors, and a pending spinner).
 *
 * Flow: validate locally with the SAME Zod schema the API uses -> POST to
 * /api/auth/signup -> on success, sign the user straight in and send them to
 * the dashboard. Validating client-side too is a courtesy (instant feedback);
 * the server validation is the one that actually protects anything.
 */
export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Field-level errors keyed by field name, plus a form-level error.
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});

    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };

    // Client-side validation for instant feedback.
    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrors({ form: data.error ?? "Could not create your account." });
        setPending(false);
        return;
      }

      // Account created — sign in with the same credentials, no redirect yet
      // so we can handle the result ourselves.
      const result = await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });

      if (result?.error) {
        // Extremely unlikely (we just created it) but handle it honestly.
        setErrors({ form: "Account created — please log in." });
        router.push("/login");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrors({ form: "Network error. Please try again." });
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-rule bg-surface p-6 shadow-sm">
      <h1 className="font-serif text-2xl text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Start reading your documents in a new way.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Name" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="ada@example.com" />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" />
        </Field>

        {errors.form && (
          <p className="text-sm text-flag" role="alert">
            {errors.form}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

/** A labelled field with an inline error message below it. */
function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && (
        <p className="text-xs text-flag" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
