"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/** Ends the session and returns to the login page. */
export function LogoutButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
      Log out
    </Button>
  );
}
