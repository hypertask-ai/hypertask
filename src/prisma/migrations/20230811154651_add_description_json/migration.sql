-- AlterTable
ALTER TABLE "Section" ALTER COLUMN "ranking" SET DEFAULT 'A0200';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "descriptionJson" JSONB DEFAULT '{"content": [], "type": ""}';
