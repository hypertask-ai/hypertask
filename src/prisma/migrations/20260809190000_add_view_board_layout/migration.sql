-- Optional per-view layout. Existing views remain NULL and inherit the browser preference.
ALTER TABLE "View" ADD COLUMN "board_layout" TEXT;
