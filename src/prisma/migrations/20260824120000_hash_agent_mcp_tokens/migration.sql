-- Agent bearer tokens stop living in the database in plaintext.
--
-- The stored token was only ever read for two things: its `jti`, which is the
-- revocation generation an OAuth access token carries in place of the bearer
-- token, and an equality check against the token a caller presented. Both
-- survive without the plaintext: keep the sha256 digest and the jti instead.
--
-- Existing rows are backfilled from the token already stored, so no live agent
-- credential is invalidated by this migration. The jti is read out of the JWT
-- payload segment, which is base64url: `-_` are translated back to `+/` and the
-- `=` padding Postgres requires is restored before decoding.

ALTER TABLE "Agent"
  ADD COLUMN "mcpTokenHash" VARCHAR(64),
  ADD COLUMN "mcpTokenJti" TEXT;

UPDATE "Agent"
SET
  "mcpTokenHash" = encode(sha256("mcpToken"::bytea), 'hex'),
  "mcpTokenJti" = convert_from(
    decode(
      translate(split_part("mcpToken", '.', 2), '-_', '+/')
        || repeat('=', (4 - length(split_part("mcpToken", '.', 2)) % 4) % 4),
      'base64'
    ),
    'UTF8'
  )::jsonb ->> 'jti'
WHERE "mcpToken" IS NOT NULL
  -- Only a well-formed JWT is decoded. A stored value that is not one could
  -- never have authenticated anything, and letting `decode` or the `jsonb`
  -- cast raise on it would fail the whole deploy over a dead row.
  AND "mcpToken" ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$'
  AND convert_from(
        decode(
          translate(split_part("mcpToken", '.', 2), '-_', '+/')
            || repeat('=', (4 - length(split_part("mcpToken", '.', 2)) % 4) % 4),
          'base64'
        ),
        'UTF8'
      ) ~ '^\s*\{';

-- A stored token with no readable jti could never have authenticated anything
-- (validation has always required a generation match), so it is cleared rather
-- than left as a hash that can never be revoked.
UPDATE "Agent"
SET "mcpTokenHash" = NULL
WHERE "mcpTokenJti" IS NULL;

ALTER TABLE "Agent" DROP COLUMN "mcpToken";
