/** Read-only inspection of the live database. Prints structure, no data. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const rows = async (sql) => db.$queryRawUnsafe(sql);

const tables = await rows(`
  SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
const exts = await rows(`
  SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm') ORDER BY extname`);
const idx = await rows(`
  SELECT indexname, tablename FROM pg_indexes
  WHERE schemaname='public'
    AND indexname IN ('document_chunks_embedding_idx','document_chunks_fts_idx','documents_filename_trgm_idx')
  ORDER BY indexname`);
const cons = await rows(`
  SELECT conname FROM pg_constraint WHERE conname='comment_single_author'`);
const col = await rows(`
  SELECT format_type(a.atttypid, a.atttypmod) AS type
  FROM pg_attribute a
  WHERE a.attrelid='public.document_chunks'::regclass AND a.attname='embedding'`);

console.log("\nTABLES (" + tables.length + ")");
for (const t of tables) console.log("  • " + t.tablename);

console.log("\nEXTENSIONS");
for (const e of exts) console.log(`  ✓ ${e.extname} v${e.extversion}`);
for (const w of ["vector", "pg_trgm"])
  if (!exts.some((e) => e.extname === w)) console.log("  ✗ " + w + " MISSING");

console.log("\nEMBEDDING COLUMN");
console.log(col.length ? "  ✓ document_chunks.embedding is " + col[0].type
                       : "  ✗ document_chunks.embedding does not exist");

console.log("\nHAND-WRITTEN INDEXES");
for (const w of ["document_chunks_embedding_idx","document_chunks_fts_idx","documents_filename_trgm_idx"])
  console.log((idx.some((i) => i.indexname === w) ? "  ✓ " : "  ✗ MISSING ") + w);

console.log("\nCHECK CONSTRAINT");
console.log(cons.length ? "  ✓ comment_single_author is enforced"
                        : "  ✗ comment_single_author MISSING");

// Prove pgvector's cosine operator works end to end.
// Cosine distance is undefined for an all-zero vector, so the probe uses two
// real unit vectors: identical -> 0, orthogonal -> 1.
const v = (i) => "[" + Array.from({ length: 768 }, (_, n) => (n === i ? 1 : 0)).join(",") + "]";
const probe = await rows(
  `SELECT '${v(0)}'::vector <=> '${v(0)}'::vector AS same,
          '${v(0)}'::vector <=> '${v(1)}'::vector AS orthogonal`
);
const vecOk = Number(probe[0].same) === 0 && Number(probe[0].orthogonal) === 1;
console.log("\nPGVECTOR SMOKE TEST");
console.log(
  (vecOk ? "  ✓ " : "  ✗ ") +
    `cosine operator <=> : identical=${probe[0].same}, orthogonal=${probe[0].orthogonal}`
);

await db.$disconnect();
console.log("");
