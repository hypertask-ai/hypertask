-- HTPR-9019: tables for the per-user, flag-gated switch of saved model
-- choices to Auto. The switch itself runs in the app
-- (src/lib/ai/htpr9019ModelChoiceAuto.ts) for the users the flag is on for,
-- so no production choice changes while the flag is Owner + QA.
-- Image generation has no Auto model, so it is never stored here.

CREATE TABLE "htpr_9019_model_choice_auto_done" (
    "user_id" INTEGER NOT NULL,
    "done_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "htpr_9019_model_choice_auto_done_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "htpr_9019_model_choice_backup" (
    "user_id" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "previous_value" TEXT NOT NULL,
    "backed_up_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "htpr_9019_model_choice_backup_pkey" PRIMARY KEY ("user_id", "location")
);
