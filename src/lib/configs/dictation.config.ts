export const dictationConfig = {
  api: {
    deepgram: {
      endpoint: "https://api.deepgram.com/v1/listen",
      apiKey: process.env.DEEPGRAM_API_KEY || "",
      model: "nova-3",
      language: "en",
    },
  },
} as const;
