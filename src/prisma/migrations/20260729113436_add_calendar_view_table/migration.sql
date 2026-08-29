CREATE TABLE "Calendar_View" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" "ViewVisibility" NOT NULL DEFAULT 'Private',
    "projectIds" INTEGER[],
    "taskFilters" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "sort" JSONB,

    CONSTRAINT "Calendar_View_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Calendar_View_userId_idx" ON "Calendar_View"("userId");

CREATE INDEX "Calendar_View_visibility_idx" ON "Calendar_View"("visibility");

ALTER TABLE "Calendar_View" ADD CONSTRAINT "Calendar_View_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
