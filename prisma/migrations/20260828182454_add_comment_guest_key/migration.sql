-- DropIndex
DROP INDEX "document_chunks_embedding_idx";

-- DropIndex
DROP INDEX "documents_filename_trgm_idx";

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "guestKey" TEXT;
