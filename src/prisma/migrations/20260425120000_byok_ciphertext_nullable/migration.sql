-- Allow enabled toggles before a key is saved; ciphertext filled via debounced save.
ALTER TABLE "TeamByokApiKey" ALTER COLUMN "ciphertext" DROP NOT NULL;
