import type { Prisma } from '@prisma/client';
import type { CommentDependencies, CreateCommentParams } from './commentCreationTypes';
import type { persistComment } from './persistComment';

export type CommentFanoutContext = CreateCommentParams & {
  dependencies: CommentDependencies;
  task: Prisma.TaskGetPayload<{ include: { project: { include: { team: true; owner: { include: { devices: true } } } } } }>;
  creatorIdNum: number;
  hyperAiId: number;
  transactionResult: Awaited<ReturnType<typeof persistComment>>;
};

export type CommentNotificationClaim = {
  activityId: string;
  processingAt: Date;
} | null;

export type CommentNotificationState = {
  commentNotificationDeliveryKeys: string[];
  commentMentionsAttemptedAt: Date | null;
  commentFcmAttemptedAt: Date | null;
  commentEmailsAttemptedAt: Date | null;
} | null;
