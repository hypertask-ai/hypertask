-- Per-user voice-dictation language preference (default English).
ALTER TABLE "UserSetting" ADD COLUMN "dictationLanguage" TEXT NOT NULL DEFAULT 'en';
