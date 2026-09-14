-- HTPR-6422: saved My Tasks views are user-scoped because they can span boards.

-- CreateTable
CREATE TABLE "MyTasksView" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyTasksView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MyTasksView_userId_idx" ON "MyTasksView"("userId");

-- AddForeignKey
ALTER TABLE "MyTasksView" ADD CONSTRAINT "MyTasksView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
