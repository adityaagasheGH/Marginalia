import bcrypt from "bcryptjs";

// Each +1 doubles hashing time. 12 is ~250ms — expensive to brute-force
// offline, fast enough that login still feels instant.
const BCRYPT_COST = 12;

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
