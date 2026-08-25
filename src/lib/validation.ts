import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

/**
 * Runtime validation schemas, shared between API routes and the forms that
 * post to them. One definition per shape means the client and server can
 * never disagree about what "valid" means.
 *
 * TypeScript types are erased at build time and cannot guard a route against
 * arbitrary request bodies — Zod checks the actual data at runtime. Every
 * route validates its input before doing anything else (docs/API_SPEC.md).
 */

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  // .toLowerCase() normalizes so "Ada@x.com" and "ada@x.com" are one account.
  email: z.email("Enter a valid email address.").toLowerCase(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200, "Password must be at most 200 characters."),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address.").toLowerCase(),
  password: z.string().min(1, "Password is required."),
});

// `z.infer` turns a schema back into a TypeScript type, so validated data is
// fully typed downstream with no duplicate hand-written interface.
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
