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

test("dictation service contains no direct OpenAI credential or endpoint", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/services/dictation/transcriptionProviders.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /OPENAI_API_KEY/);
  assert.doesNotMatch(source, /api\.openai\.com/);
  assert.doesNotMatch(source, /transcribeWithOpenAI/);
  assert.match(source, /DEEPGRAM_API_KEY/);
  assert.match(source, /tag/);
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

test("dictation routes authenticate before parsing paid audio payloads", () => {
  const formRoute = fs.readFileSync(
    path.join(root, "src/app/api/dictation/transcribe/route.ts"),
    "utf8",
  );
  const jsonRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/audio-transcript/route.ts"),
    "utf8",
  );

  assert.ok(
    formRoute.indexOf("getSessionUser(request.headers)") <
      formRoute.indexOf("request.formData()"),
    "form-data dictation must authenticate before parsing the upload",
  );
  assert.ok(
    jsonRoute.indexOf("getSessionUser(request.headers)") <
      jsonRoute.indexOf("request.json()"),
    "JSON dictation must authenticate before parsing base64 audio",
  );
  assert.match(formRoute, /MAX_DICTATION_AUDIO_BYTES/);
  assert.match(jsonRoute, /MAX_DICTATION_AUDIO_BYTES/);
  assert.match(formRoute, /status: 413/);
  assert.match(jsonRoute, /status: 413/);
  assert.match(formRoute, /teamContext\.projectId !== projectId/);
  assert.match(jsonRoute, /teamContext\.projectId !== body\.projectId/);
  for (const route of [formRoute, jsonRoute]) {
    assert.match(route, /isGuestUserId/);
    const guestCheckAt = route.indexOf("await isGuestUserId");
    const bodyParseAt = Math.max(
      route.indexOf("request.formData()"),
      route.indexOf("request.json()"),
    );
    assert.ok(guestCheckAt >= 0 && guestCheckAt < bodyParseAt);
  }
});

test("the client rejects oversized dictation before base64 encoding", () => {
  const audioButton = fs.readFileSync(
    path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
    "utf8",
  );
  const sizeCheckAt = audioButton.indexOf(
    "audioBlob.size > MAX_DICTATION_AUDIO_BYTES",
  );
  const base64At = audioButton.indexOf("reader.readAsDataURL(audioBlob)");

  assert.ok(sizeCheckAt >= 0 && sizeCheckAt < base64At);
  assert.match(audioButton, /typeof payload\?\.error === "string"/);
  assert.match(audioButton, /toast\.error/);
});

test("paid dictation requires write access and keeps teamless owners", () => {
  const providerGate = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/providerGate.ts"),
    "utf8",
  );

  assert.match(providerGate, /taskWriteAccessWhere\(userId\)/);
  assert.doesNotMatch(providerGate, /getProjectWhere\(userId\)/);
  assert.doesNotMatch(providerGate, /projectContentAccessWhere\(userId\)/);
  assert.match(providerGate, /projectId: project\?\.id \?\? null/);
});

test("the unguarded standalone demo-generation endpoint stays removed", () => {
  assert.equal(
    fs.existsSync(
      path.join(root, "src/app/api/demo/generate-board/route.ts"),
    ),
    false,
  );

  const guestRoute = fs.readFileSync(
    path.join(root, "src/app/api/demo/guest/route.ts"),
    "utf8",
  );
  assert.match(guestRoute, /consumeGuestCreation/);
  assert.match(guestRoute, /consumeBoardRegeneration/);
});
