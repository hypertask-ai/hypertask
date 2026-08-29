-- HTPR-4858: let each board explicitly identify finished columns.
-- Additive, nullable column; no existing row is touched.
ALTER TABLE "Section" ADD COLUMN "isDone" BOOLEAN;
