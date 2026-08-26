"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@/lib/validation";

/**
 * Login form. On any failure it shows a single generic message — "Invalid
 * email or password" — regardless of whether the email exists or the password
 * was wrong. A more specific message would tell an attacker which emails have
 * accounts (docs/SECURITY.md § 2).
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Where to send the user after login (set by middleware when it bounced
  // them here from a protected page). Defaults to the dashboard.
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const values = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setError("Invalid email or password.");
      return;
    }

    setPending(true);
    const result = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });

    if (result?.error) {
      // Distinguish "wrong credentials" from "the server broke". Auth.js
      // reports a rejected login as CredentialsSignin; anything else (a
      // database outage, a misconfigured secret) is our fault, not the
      // user's, and telling them their password is wrong sends them off to
      // create a duplicate account chasing a problem they cannot fix.
      setError(
        result.error === "CredentialsSignin"
          ? "Invalid email or password."
          : "We couldn't reach the server. Please try again in a moment.",
      );
      setPending(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="rounded-md border border-rule bg-surface p-6 shadow-sm">
      <h1 className="font-serif text-2xl text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-muted">Log in to your documents.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="ada@example.com" />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-ink-muted hover:text-primary hover:underline">
              Forgot?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Your password" />
        </div>

        {error && (
          <p className="text-sm text-flag" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
