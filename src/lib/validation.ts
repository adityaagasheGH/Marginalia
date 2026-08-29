import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

/**
 * Runtime validation schemas, shared between API routes and the forms that
 * post to them. One definition per shape means the client and server can
 * never disagree about what "valid" means.
 *
 * TypeScript types are erased at build time and cannot guard a route against
 * arbitrary request bodies — Zod checks the actual data at runtime. Every
 * route validates its input before doing anything else.
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

// ── Sharing ─────────────────────────────────────────────────────────────

export const createShareSchema = z.object({
  // VIEW is read-only; COMMENT also allows posting. Defaults to COMMENT
  // because the point of sharing here is to collect feedback.
  permission: z.enum(["VIEW", "COMMENT"]).default("COMMENT"),
  // null / omitted means the link never expires.
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export const identifySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name so others know who commented.")
    .max(40, "Name must be at most 40 characters."),
});

// ── Comments ────────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Comment can't be empty.")
    .max(5000, "Comment must be at most 5000 characters."),
  // Present when replying. The API rejects a parentId that is itself a
  // reply — threading is one level deep, matching the schema's design.
  parentId: z.string().cuid2().nullable().optional(),
  // Optional "attached to page 12" anchor.
  pageNumber: z.number().int().min(1).max(10_000).nullable().optional(),
});
