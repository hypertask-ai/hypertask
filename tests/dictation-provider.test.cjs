const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/dictation-provider-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

test("dictation only supports Deepgram and migrates legacy OpenAI settings", () => {
  const {
    DEFAULT_DICTATION_PROVIDER,
    DICTATION_PROVIDER_OPTIONS,
    isDictationProvider,
    resolveDictationProvider,
  } = jiti(path.join(root, "src/lib/dictationProvider.ts"));

  assert.equal(DEFAULT_DICTATION_PROVIDER, "deepgram");
  assert.deepEqual(DICTATION_PROVIDER_OPTIONS, [
    { value: "deepgram", label: "Deepgram" },
  ]);
  assert.equal(isDictationProvider("deepgram"), true);
  assert.equal(isDictationProvider("openai"), false);
  assert.equal(
    resolveDictationProvider({ dictationProvider: "openai" }),
    "deepgram",
  );
});

test("Deepgram receives the owning team and user attribution tags", async () => {
  const previousKey = process.env.DEEPGRAM_API_KEY;
  const previousFetch = global.fetch;
  process.env.DEEPGRAM_API_KEY = "deepgram-test-key";

  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = new URL(String(url));
    return {
      ok: true,
      json: async () => ({
        results: {
          channels: [{ alternatives: [{ transcript: "Attributed text" }] }],
        },
      }),
    };
  };

  try {
    const { transcribeAudioFile } = jiti(
      path.join(root, "src/lib/services/dictation/transcriptionProviders.ts"),
    );
    const transcript = await transcribeAudioFile(
      "deepgram",
      new File([Buffer.from("audio")], "audio.webm", {
        type: "audio/webm",
      }),
      { tags: ["team:team-hypertask", "user:6"] },
    );

    assert.equal(transcript, "Attributed text");
    assert.ok(requestedUrl);
    assert.deepEqual(requestedUrl.searchParams.getAll("tag"), [
      "team:team-hypertask",
      "user:6",
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousKey;
  }
});

test("dictation rejects oversized audio before contacting Deepgram", async () => {
  const previousKey = process.env.DEEPGRAM_API_KEY;
  const previousFetch = global.fetch;
  process.env.DEEPGRAM_API_KEY = "deepgram-test-key";

  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("oversized audio must not reach Deepgram");
  };

  try {
    const {
      DictationAudioTooLargeError,
      MAX_DICTATION_AUDIO_BYTES,
      transcribeAudioFile,
    } = jiti(
      path.join(root, "src/lib/services/dictation/transcriptionProviders.ts"),
    );
    const oversizedFile = new File(
      [new Uint8Array(MAX_DICTATION_AUDIO_BYTES + 1)],
      "too-large.webm",
      { type: "audio/webm" },
    );

    await assert.rejects(
      transcribeAudioFile("deepgram", oversizedFile),
      DictationAudioTooLargeError,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousKey;
  }
});

test("the unguarded standalone demo-generation endpoint stays removed", () => {
  assert.equal(
    fs.existsSync(
      path.join(root, "src/app/api/demo/generate-board/route.ts"),
    ),
    false,
  );
});
