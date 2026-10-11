-- HTPR-7038: schema only. The server performs the flagged per-user reset.
CREATE TABLE htpr_7038_model_choice_backup (
    user_id INTEGER NOT NULL,
    location TEXT NOT NULL,
    previous_value TEXT NOT NULL,
    backed_up_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT htpr_7038_model_choice_backup_pkey PRIMARY KEY (user_id, location)
);

CREATE TABLE htpr_7038_model_choice_reset_done (
    user_id INTEGER NOT NULL,
    reset_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT htpr_7038_model_choice_reset_done_pkey PRIMARY KEY (user_id)
);
