// Layout rules for the mobile comment composer's action row.
//
// Split out of index.tsx so the rule can be tested directly instead of being
// inferred from rendered markup, the same way taskTemplatePrefill.ts is.

/**
 * Where the dictation mic sits in the mobile comment composer.
 *
 * Empty composer: the mic IS the primary action, filled and pinned right.
 * The moment there is text, Send owns that slot and the mic steps back to a
 * bare glyph immediately beside Send. Recording overrides both and takes the
 * full row for the waveform.
 *
 * Transcribing keeps the right-hand slot too. Streamed transcript lands in the
 * editor before `onProcessingChange(false)` fires, so `hasText` flips true
 * while the spinner is still up. Demoting on `hasText` alone would slide the
 * spinner into the middle of the row for that window, and Send is still gated
 * behind `!audioProcessing`, so nothing would hold the primary slot at all.
 *
 * These are flex `order` values on ONE row, never conditional re-parenting:
 * rendering the mic under a different parent unmounts it and throws away an
 * in-flight MediaRecorder (#2666).
 */
export function mobileEditorTriggerText(
  trigger: "@" | "/",
  textBeforeCaret: string,
) {
  if (trigger === "@" && textBeforeCaret && !/\s$/.test(textBeforeCaret)) {
    return " @";
  }
  return trigger;
}

export function mobileCommentMicWrapperClass({
  hasText,
  isRecording,
  isProcessing,
}: {
  hasText?: boolean;
  isRecording?: boolean;
  isProcessing?: boolean;
}) {
  if (isRecording) return "order-7 flex-1 w-full";
  if (isProcessing) return "order-6 ml-auto";
  return hasText ? "order-5 ml-auto" : "order-6 ml-auto";
}

