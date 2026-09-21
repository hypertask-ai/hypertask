export const dictationConfig = {
  api: {
    deepgram: {
      endpoint: "https://api.deepgram.com/v1/listen",
      apiKey: process.env.DEEPGRAM_API_KEY || "", // Never hardcode API keys - use environment variables only
      // nova-3: Deepgram's latest general model. Forced English via `language`
      // below to match Whisper's behaviour and avoid non-English gibberish.
      model: "nova-3",
      language: "en",
    },
  },
} as const;
