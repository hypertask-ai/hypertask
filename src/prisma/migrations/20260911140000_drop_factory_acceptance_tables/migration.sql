-- HYFA-43 retired factory acceptance. The code and the seven Factory* models
-- were removed from schema.prisma (#518), but the two migrations that created
-- the tables stayed in history, so replaying the migration history produced a
-- database that still had them and `prisma migrate diff` reported drift on
-- every run.
--
-- The tables were opt-in storage only: 20260910200000_factory_acceptance and
-- 20260911010000_factory_template_approval never enrolled a project, so no
-- project could write to them through the app. IF EXISTS keeps the migration
-- safe to replay where the tables are already gone.
DROP TABLE IF EXISTS "FactorySemanticReceipt";
DROP TABLE IF EXISTS "FactoryTemplate";
DROP TABLE IF EXISTS "FactoryTransitionRequest";
DROP TABLE IF EXISTS "FactoryGrant";
DROP TABLE IF EXISTS "FactoryRevision";
DROP TABLE IF EXISTS "FactoryContract";
DROP TABLE IF EXISTS "FactoryEnrollment";
