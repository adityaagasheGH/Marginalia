/**
 * Auth.js catch-all route. It handles every /api/auth/* request — sign-in,
 * sign-out, session, CSRF — via the handlers built in auth.ts. We write no
 * logic here; Auth.js owns these endpoints.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
