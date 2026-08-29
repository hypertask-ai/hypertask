-- CreateIndex
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");

-- CreateIndex
CREATE INDEX "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Reaction_commentId_isDeleted_emoji_unified_idx" ON "Reaction"("commentId", "isDeleted", "emoji", "unified");

-- CreateIndex
CREATE INDEX "SavedContent_commentId_taskId_userId_type_idx" ON "SavedContent"("commentId", "taskId", "userId", "type");
