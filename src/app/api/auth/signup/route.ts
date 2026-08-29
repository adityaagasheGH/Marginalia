import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, checkPasswordStrength } from "@/lib/password";
import { signupSchema } from "@/lib/validation";

/**
 * POST /api/auth/signup
 *
 * Creates an account.
 *   201 { id, email }          on success
 *   400 { error }              invalid input
 *   409 { error }              email already registered
 *
 * The password hash is never echoed back.
 */
export async function POST(request: Request) {
  // 1) Parse the JSON body. A malformed body throws, so guard it.
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // 2) Validate shape and types at runtime. `safeParse` never throws; it
  //    returns success/failure so we can craft our own response.
  const parsed = signupSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first.message }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  // 3) Strength rules that Zod's length check does not cover (common passwords).
  const weak = checkPasswordStrength(password);
  if (weak) {
    return NextResponse.json({ error: weak }, { status: 400 });
  }

  // 4) Hash before we ever touch the database — the plaintext must not live
  //    a moment longer than necessary, and never reaches storage or logs.
  const passwordHash = await hashPassword(password);

  // 5) Insert. We rely on the UNIQUE constraint on email rather than a
  //    separate "does this email exist?" query: checking then inserting has a
  //    race condition (two signups in the same instant both pass the check).
  //    Catching the unique-violation is atomic and correct.
  try {
    const user = await db.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true }, // note: passwordHash is NOT selected
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    // P2002 is Prisma's "unique constraint failed" code.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    // Anything else is unexpected: log server-side, return a generic message.
    // Never leak the raw error to the client.
    console.error("[signup] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
