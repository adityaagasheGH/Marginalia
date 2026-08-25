import bcrypt from "bcryptjs";

/**
 * Password hashing and strength rules. Every code path that touches a
 * password goes through here so the cost factor can never drift between
 * signup, login, and password reset.
 *
 * See docs/SECURITY.md § 2.
 */

/**
 * bcrypt work factor. Each +1 doubles the time to hash.
 * 12 is roughly 250ms on typical hardware — slow enough to make offline
 * brute-forcing of a stolen hash table expensive, fast enough that a login
 * still feels instant.
 */
const BCRYPT_COST = 12;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * A deliberately small list. This is not a substitute for a real breach
 * corpus (haveibeenpwned's k-anonymity API would be), but it blocks the
 * handful of passwords that show up in every credential-stuffing list at
 * zero cost and zero latency.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "letmein1", "welcome1",
  "admin123", "iloveyou", "sunshine", "princess", "football",
  "monkey123", "abc12345", "passw0rd", "trustno1", "baseball",
]);

/** Hash a plaintext password for storage. Never log the input. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Check a plaintext password against a stored hash.
 *
 * bcrypt.compare re-hashes `plaintext` using the salt and cost embedded in
 * `hash`, then compares in constant time — so it leaks no information via
 * how long it takes.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Returns an error message, or null if the password is acceptable.
 * Returning the reason (rather than a bare boolean) lets the signup form
 * show something specific and actionable.
 */
export function checkPasswordStrength(plaintext: string): string | null {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (plaintext.length > 200) {
    // bcrypt silently truncates past 72 bytes; a very long input is either a
    // mistake or an attempt to burn CPU. Reject rather than truncate.
    return "Password must be at most 200 characters.";
  }
  if (COMMON_PASSWORDS.has(plaintext.toLowerCase())) {
    return "That password is too common. Please choose another.";
  }
  return null;
}
