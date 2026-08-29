// Vercel rejects request bodies above 4.5 MB. A 3 MB raw-audio ceiling leaves
// room for base64 expansion and JSON framing, so clients get a useful error
// before the platform rejects the request.
export const MAX_DICTATION_AUDIO_BYTES = 3 * 1024 * 1024;
