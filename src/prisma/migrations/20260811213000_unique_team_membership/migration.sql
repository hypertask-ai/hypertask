-- Preserve notification links while collapsing any historical duplicate human
-- memberships before making future joins conflict-safe.
WITH merged AS (
  SELECT
    "userId",
    "teamId",
    (ARRAY_AGG(id ORDER BY id))[1] AS keep_id,
    CASE
      WHEN BOOL_OR(status = 'Accepted') THEN 'Accepted'::"InviteStatus"
      ELSE 'Invited'::"InviteStatus"
    END AS merged_status,
    MIN("invitedAt") AS merged_invited_at,
    MIN("acceptedAt") AS merged_accepted_at
  FROM "Member_Team"
  GROUP BY "userId", "teamId"
)
UPDATE "Member_Team" AS membership
SET
  status = merged.merged_status,
  "invitedAt" = merged.merged_invited_at,
  "acceptedAt" = merged.merged_accepted_at
FROM merged
WHERE membership.id = merged.keep_id;

WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "userId", "teamId"
      ORDER BY id
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "teamId"
      ORDER BY id
    ) AS duplicate_rank
  FROM "Member_Team"
)
UPDATE "Notification" AS notification
SET "member_team_Id" = ranked.keep_id
FROM ranked
WHERE notification."member_team_Id" = ranked.id
  AND ranked.duplicate_rank > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "teamId"
      ORDER BY id
    ) AS duplicate_rank
  FROM "Member_Team"
)
DELETE FROM "Member_Team" AS membership
USING ranked
WHERE membership.id = ranked.id
  AND ranked.duplicate_rank > 1;

-- Repair the cached display counter after removing duplicates. The owner counts
-- once even on legacy/guest teams where an owner membership row also exists.
UPDATE "Team" AS team
SET "totalSeats" = seat_count.actual_seats
FROM (
  SELECT
    team_inner.id AS team_id,
    (
      1 + COUNT(DISTINCT membership."userId") FILTER (
        WHERE membership.status = 'Accepted'
          AND membership."userId" <> account."userId"
      )
    )::integer AS actual_seats
  FROM "Team" AS team_inner
  JOIN "GoogleAccount" AS account
    ON account.id = team_inner."googleAccountId"
  LEFT JOIN "Member_Team" AS membership
    ON membership."teamId" = team_inner.id
  GROUP BY team_inner.id
) AS seat_count
WHERE team.id = seat_count.team_id
  AND team."totalSeats" <> seat_count.actual_seats;

CREATE UNIQUE INDEX "Member_Team_userId_teamId_key"
ON "Member_Team"("userId", "teamId");
