import bcrypt from "bcryptjs";

// Each +1 doubles hashing time. 12 is ~250ms — expensive to brute-force
// offline, fast enough that login still feels instant.
const BCRYPT_COST = 12;

export const MIN_PASSWORD_LENGTH = 8;

// Not a substitute for a breach corpus, but blocks the obvious ones for free.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "letmein1", "welcome1",
  "admin123", "iloveyou", "sunshine", "princess", "football",
  "monkey123", "abc12345", "passw0rd", "trustno1", "baseball",
]);

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/** Constant-time via bcrypt.compare, which reads salt and cost from the hash. */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/** Returns an error message, or null if acceptable. */
export function checkPasswordStrength(plaintext: string): string | null {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (plaintext.length > 200) {
    // bcrypt truncates past 72 bytes; reject rather than silently truncate.
    return "Password must be at most 200 characters.";
  }
  if (COMMON_PASSWORDS.has(plaintext.toLowerCase())) {
    return "That password is too common. Please choose another.";
  }
  return null;
}
