/**
 * Verifies .env is filled in correctly, WITHOUT ever printing a secret.
 * Values are shown only as length + first/last few characters.
 *
 *   npm run check:env
 */
import fs from "node:fs";

const FILE = ".env";
if (!fs.existsSync(FILE)) {
  console.error(`\n  ✗ ${FILE} does not exist. Create it, then run this again.\n`);
  process.exit(1);
}

const issues = [];
const env = {};

// ── Parse .env by hand so we can report line numbers on malformed lines ──
fs.readFileSync(FILE, "utf8").split(/\r?\n/).forEach((line, i) => {
  const n = i + 1;
  const t = line.trim();
  if (!t || t.startsWith("#")) return;

  const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) return issues.push(`line ${n}: could not parse "${t.slice(0, 30)}…"`);

  const [, key, rawValue] = m;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s+=/.test(t)) issues.push(`line ${n}: ${key} has a space before "="`);

  const quoted = /^".*"$/.test(rawValue);
  if (!quoted && rawValue !== "") issues.push(`line ${n}: ${key} is not wrapped in double quotes`);

  const value = quoted ? rawValue.slice(1, -1) : rawValue;
  if (/[;,]$/.test(value)) issues.push(`line ${n}: ${key} ends with a stray ";" or ","`);
  if (value !== value.trim()) issues.push(`line ${n}: ${key} has whitespace inside the quotes`);

  env[key] = value;
});

const mask = (v) => `len=${String(v.length).padStart(3)}  ${v.slice(0, 12)}…${v.slice(-4)}`;

// ── Presence ──
const REQUIRED = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_APP_URL",
];

console.log("\n  VAR                            STATUS       SHAPE");
console.log("  " + "─".repeat(72));
for (const key of REQUIRED) {
  const v = env[key];
  let status;
  if (v === undefined) { status = "MISSING";     issues.push(`${key} is missing from ${FILE}`); }
  else if (v === "")   { status = "EMPTY";       issues.push(`${key} is empty`); }
  else if (/PASTE_|_HERE/.test(v)) { status = "PLACEHOLDER"; issues.push(`${key} still has the placeholder text`); }
  else                 { status = "ok"; }
  console.log("  " + key.padEnd(30) + status.padEnd(12) + (status === "ok" ? mask(v) : "—"));
}

// ── Shape ──
const check = (ok, good, bad) => {
  console.log(ok ? `    ✓ ${good}` : `    ✗ ${bad}`);
  if (!ok) issues.push(bad);
};

const pooled = env.DATABASE_URL ?? "";
const direct = env.DIRECT_URL ?? "";
const isPg = (u) => /^postgres(ql)?:\/\//.test(u);

console.log("  " + "─".repeat(72));
console.log("  Neon connection strings:");
check(isPg(pooled), "DATABASE_URL is a postgres:// URL", "DATABASE_URL is not a postgres:// URL");
check(isPg(direct), "DIRECT_URL is a postgres:// URL",   "DIRECT_URL is not a postgres:// URL");
check(/-pooler\./.test(pooled), "DATABASE_URL uses the pooled host", "DATABASE_URL has no \"-pooler\" — that looks like the direct string");
check(!/-pooler\./.test(direct), "DIRECT_URL uses the direct host",  "DIRECT_URL contains \"-pooler\" — migrations will fail on the pooler");
check(pooled !== direct || !pooled, "the two URLs differ", "DATABASE_URL and DIRECT_URL are identical");
check(!pooled || /sslmode=require/.test(pooled), "sslmode=require is set", "DATABASE_URL is missing sslmode=require");

console.log("  API tokens:");
// Google issues two key formats: the legacy "AIza…" and the newer "AQ.…".
check(/^(AIza|AQ\.)/.test(env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""), "Gemini key has a recognised Google prefix", "Gemini key should start with \"AIza\" or \"AQ.\"");
check(/^vercel_blob_rw_/.test(env.BLOB_READ_WRITE_TOKEN ?? ""), "Blob token starts with vercel_blob_rw_", "Blob token should start with \"vercel_blob_rw_\"");
check((env.AUTH_SECRET ?? "").length >= 32, "AUTH_SECRET is long enough", "AUTH_SECRET must be at least 32 characters");

console.log("  " + "─".repeat(72));
if (issues.length === 0) {
  console.log("\n  ✓ .env looks good.\n");
} else {
  console.log(`\n  ${issues.length} problem(s):`);
  for (const i of issues) console.log("    • " + i);
  console.log("");
  process.exit(1);
}
