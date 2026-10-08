/**
 * Password-strength policy. Kept free of server-only imports (no bcrypt) so
 * the signup form and the API route enforce exactly the same rules.
 *
 * 12+ characters follows current guidance that length is the strongest
 * single factor; the character-class rules are an explicit product
 * requirement on top of that. The maximum is a byte limit because bcrypt
 * silently ignores everything past 72 bytes — better to reject than to let
 * two different long passwords hash identically.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

export type PasswordRule = {
  id: string;
  label: string;
  test: (pw: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (pw) => pw.length >= MIN_PASSWORD_LENGTH,
  },
  { id: "lower", label: "A lowercase letter (a–z)", test: (pw) => /\p{Ll}/u.test(pw) },
  { id: "upper", label: "An uppercase letter (A–Z)", test: (pw) => /\p{Lu}/u.test(pw) },
  { id: "number", label: "A number (0–9)", test: (pw) => /\p{Nd}/u.test(pw) },
  {
    id: "special",
    label: "A special character (e.g. @ # _ $ %)",
    test: (pw) => /[^\p{L}\p{Nd}\s]/u.test(pw),
  },
];

/** Returns an error message naming everything that is missing, or null. */
export function checkPasswordStrength(pw: string): string | null {
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} characters).`;
  }
  const missing = PASSWORD_RULES.filter((r) => !r.test(pw));
  if (missing.length === 0) return null;

  const NOUNS: Record<string, string> = {
    lower: "a lowercase letter",
    upper: "an uppercase letter",
    number: "a number",
    special: "a special character (e.g. @ # _ $ %)",
  };
  const join = (xs: string[]) =>
    xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

  const tooShort = missing.some((r) => r.id === "length");
  const includes = missing.filter((r) => r.id !== "length").map((r) => NOUNS[r.id]);

  const clauses: string[] = [];
  if (tooShort) clauses.push(`be at least ${MIN_PASSWORD_LENGTH} characters long`);
  if (includes.length) clauses.push(`include ${join(includes)}`);
  return `Password must ${clauses.join(" and ")}.`;
}
