ALTER TABLE "Section" ADD COLUMN "wipLimit" INTEGER;
ALTER TABLE "Section" ADD CONSTRAINT "Section_wipLimit_positive" CHECK ("wipLimit" > 0);
