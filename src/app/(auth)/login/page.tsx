import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Log in — Marginalia" };

export default function LoginPage() {
  // LoginForm reads useSearchParams (for callbackUrl); Next 15 requires it to
  // be inside a Suspense boundary, otherwise the page fails to build.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
