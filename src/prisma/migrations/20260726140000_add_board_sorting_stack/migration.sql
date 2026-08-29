-- Optional secondary/tertiary sort levels for a board view, shape [{ mode, order }].
-- Nullable and additive: NULL means the single-level sort that already lives in
-- board_sorting_mode/board_sorting_order, so existing views keep sorting exactly as before.
ALTER TABLE "View" ADD COLUMN "board_sorting_stack" JSONB;
