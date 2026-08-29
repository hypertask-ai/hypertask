-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project_View" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "default_view_id" TEXT,

    CONSTRAINT "Project_View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User_Project_View" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "appliedViewId" TEXT,
    "project_view_id" TEXT NOT NULL,

    CONSTRAINT "User_Project_View_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "View_userId_key" ON "View"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_View_projectId_key" ON "Project_View"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_View_default_view_id_key" ON "Project_View"("default_view_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_Project_View_userId_key" ON "User_Project_View"("userId");

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project_View" ADD CONSTRAINT "Project_View_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project_View" ADD CONSTRAINT "Project_View_default_view_id_fkey" FOREIGN KEY ("default_view_id") REFERENCES "View"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User_Project_View" ADD CONSTRAINT "User_Project_View_appliedViewId_fkey" FOREIGN KEY ("appliedViewId") REFERENCES "View"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User_Project_View" ADD CONSTRAINT "User_Project_View_project_view_id_fkey" FOREIGN KEY ("project_view_id") REFERENCES "Project_View"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
