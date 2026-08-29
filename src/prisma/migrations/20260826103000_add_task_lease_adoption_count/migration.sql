-- HTPR-5699: overlapping calls can share one adopted lease without letting the
-- first call's hand-back end the lease while another call is still writing.
-- Existing rows stay uncounted so mixed-version traffic cannot join a lease
-- that an old app instance may release without reference counting.
ALTER TABLE "TaskLease"
ADD COLUMN "adoptionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "adoptionRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
