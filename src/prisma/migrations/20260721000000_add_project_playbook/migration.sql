-- HTPR-4442: per-board playbook + definition-of-done checklist.
-- Additive, nullable column; no existing row is touched.
ALTER TABLE "Project" ADD COLUMN "playbook" JSONB;
