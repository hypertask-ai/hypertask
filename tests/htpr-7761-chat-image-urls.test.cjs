const assert = require("node:assert/strict");
const test = require("node:test");
const { generateText } = require("ai");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7761-chat-image-urls";
const imageUrl = "https://screencast2.com/bobER.png";
const user = { id: 985, email: "qa@example.invalid" };
const pixels = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function harness({ enabled = true, modelId = "claude-haiku-5.5", download } = {}) {
  const downloads = [], replies = [], checks = [];
  const content = load("src/lib/ai/chatStream/content.ts", {
    "@/lib/mcp/attachments/safeFetch": {
      safeFetchAttachmentUrl: async (url, signal) => {
        downloads.push({ url, signal });
        return download ? download(url, signal) : { buffer: pixels, contentType: "image/png" };
      },
    },
  });
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/ai/prompts/registry": {},
    "@/lib/prisma": {},
    "@/lib/flags/keys": load("src/lib/flags/definitions/htpr-7761-chat-image-urls.ts", {}),
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag && enabled;
    } },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "Chat instructions" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/chatStream/content": content,
    "@/lib/ai/tools/metadata": {},
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({}) },
    "./modelReply": { generateModelReply: async (_state, inputs) => { replies.push(inputs); return null; } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  const controller = new AbortController();
  const send = async (body = { message: `Describe ${imageUrl}` }) => {
    await runModelTurn({ body, dbUser: user, selected: { model: {}, resolvedModelId: modelId }, providerAbort: controller }, body, {});
    return replies.at(-1).messages[0].content;
  };
  return { send, downloads, checks, controller };
}

const files = (content) => Array.isArray(content) ? content.filter((part) => part.type === "file") : [];
const text = (content) => typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

for (const modelId of ["claude-haiku-5.5", "openai/gpt-6-luna", "google/gemini-3.8-flash", "moonshotai/kimi-k2.5"]) {
  test(`the real model turn sends URL pixels as image content for ${modelId}`, async () => {
    const h = harness({ modelId });
    const result = await h.send();
    assert.deepEqual(files(result), [{ type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array(pixels) } }]);
    assert.match(text(result), /selected model accepts images/);
    assert.deepEqual(h.downloads, [{ url: imageUrl, signal: h.controller.signal }]);
    assert.equal(h.checks.some(([key, userId]) => key === flag && userId === 985), true);
  });
}

test("the SDK hands bytes, not just URL text, to the provider", async () => {
  const h = harness();
  const content = await h.send();
  let providerPrompt;
  const model = {
    specificationVersion: "v4", provider: "fixture", modelId: "vision", supportedUrls: {},
    doGenerate: async ({ prompt }) => {
      providerPrompt = prompt;
      return { content: [{ type: "text", text: "Screenshot received" }], finishReason: { unified: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } };
    },
  };
  const result = await generateText({ model, messages: [{ role: "user", content }] });
  assert.equal(result.text, "Screenshot received");
  assert.deepEqual(providerPrompt[0].content.filter((part) => part.type === "file").map(({ type, mediaType, data }) => ({ type, mediaType, data })), [{ type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array(pixels) } }]);
});

test("flag Off retains text-only links and existing image/PDF attachments without downloading", async () => {
  const h = harness({ enabled: false });
  const body = { message: `Describe ${imageUrl}`, images64: [{ url: imageUrl, mimeType: "image/png" }], pdfs64: [{ url: "https://files.example.test/note.pdf", mimeType: "application/pdf" }] };
  const result = await h.send(body);
  assert.deepEqual(files(result), [
    { type: "file", mediaType: "image/png", filename: undefined, data: new URL(imageUrl) },
    { type: "file", mediaType: "application/pdf", filename: undefined, data: new URL("https://files.example.test/note.pdf") },
  ]);
  assert.match(text(result), /User query: Describe https:\/\/screencast2.com\/bobER.png/);
  assert.doesNotMatch(text(result), /IMAGE CAPABILITY/);
  assert.deepEqual(h.downloads, []);
  assert.equal(typeof await h.send(), "string");
});

test("text-only models acknowledge supplied images without sending unsupported image parts", async () => {
  const h = harness({ modelId: "deepseek/deepseek-v4.1-flash-1017" });
  const result = await h.send({ message: `Describe ${imageUrl}`, images64: [{ url: imageUrl, mimeType: "image/png" }], pdfs64: [{ url: "https://files.example.test/note.pdf", mimeType: "application/pdf" }] });
  assert.match(text(result), /selected model is text-only/);
  assert.match(text(result), /Images were supplied by the user/);
  assert.deepEqual(files(result).map((part) => part.mediaType), ["application/pdf"]);
  assert.deepEqual(h.downloads, []);
});

test("custom models do not get an invented vision capability", async () => {
  const h = harness({ modelId: "my-custom-model" });
  const result = await h.send();
  assert.match(text(result), /Image support is unknown/);
  assert.match(text(result), /Images were supplied/);
  assert.deepEqual(files(result), []);
  assert.deepEqual(h.downloads, []);
});

test("custom models retain existing image uploads without automatic link downloads", async () => {
  const h = harness({ modelId: "my-custom-vision-model" });
  const result = await h.send({ message: `Describe ${imageUrl}`, images64: [{ url: imageUrl, mimeType: "image/png" }] });
  assert.deepEqual(files(result), [{ type: "file", mediaType: "image/png", filename: undefined, data: new URL(imageUrl) }]);
  assert.match(text(result), /Image support is unknown/);
  assert.doesNotMatch(text(result), /Image inputs were not sent|were not sent as image content/);
  assert.deepEqual(h.downloads, []);
});

test("signed image URL query values retain trailing punctuation", async () => {
  for (const suffix of ["!", ")", ",", ".", ";", "?", "]", "}"]) {
    const h = harness();
    const signed = `https://files.example.test/screenshot.png?token=fixture${suffix}`;
    const result = await h.send({ message: `Describe <a href="${signed}">image</a>` });
    assert.deepEqual(h.downloads.map(({ url }) => url), [signed]);
    assert.equal(files(result).length, 1);
  }
});

test("duplicate links, punctuation and query strings are handled without fetching history or unrelated links", async () => {
  const h = harness();
  const signed = "https://files.example.test/screenshot.PNG?token=fixture&v=2";
  const result = await h.send({ message: `See (${imageUrl}), ${imageUrl}. <a href="${signed}">image</a> https://example.test/page https://example.test/image.svg`, chat_history: [{ role: "user", content: "https://old.example.test/old.png" }] });
  assert.deepEqual(h.downloads.map(({ url }) => url), [imageUrl, signed]);
  assert.equal(files(result).length, 2);
});

test("an attached hosted image remains an image and is not downloaded again as a bare link", async () => {
  const h = harness();
  const result = await h.send({ message: `Describe ${imageUrl}`, images64: [{ url: imageUrl, mimeType: "image/png" }] });
  assert.deepEqual(files(result), [{ type: "file", mediaType: "image/png", filename: undefined, data: new URL(imageUrl) }]);
  assert.deepEqual(h.downloads, []);
});

test("failed and non-image links are explained without losing a readable image", async () => {
  const h = harness({ download: async (url) => {
    if (url.includes("missing")) throw new Error("HTTP 404 internal detail");
    return { buffer: pixels, contentType: url.includes("html") ? "text/plain" : "image/png" };
  } });
  const result = await h.send({ message: `${imageUrl} https://example.test/missing.png https://example.test/html.png` });
  assert.equal(files(result).length, 1);
  assert.match(text(result), /missing.png: could not be downloaded safely/);
  assert.match(text(result), /html.png: did not return a supported image/);
  assert.doesNotMatch(text(result), /HTTP 404 internal detail/);
});

test("new linked downloads are bounded and the omission is explicit", async () => {
  const h = harness();
  const result = await h.send({ message: Array.from({ length: 6 }, (_, index) => `https://example.test/${index}.png`).join(" ") });
  assert.deepEqual(h.downloads.map(({ url }) => url), [0, 1, 2, 3].map((index) => `https://example.test/${index}.png`));
  assert.equal(files(result).length, 4);
  assert.match(text(result), /Only the first four new image links were loaded/);
});

test("cancelling a download cancels the turn instead of starting the model with a failure notice", async () => {
  const h = harness({ download: async () => { h.controller.abort(); throw new Error("cancelled"); } });
  await assert.rejects(h.send(), /cancelled/);
  assert.equal(h.controller.signal.aborted, true);
});

test("the real public-address downloader refuses loopback links through the new preparation path", async () => {
  const { createImageAwareUserContent } = load("src/lib/ai/chatStream/content.ts", {});
  const result = await createImageAwareUserContent({ message: "Read http://127.0.0.1/private.png" }, user, "", "claude-haiku-5.5", new AbortController().signal);
  assert.match(text(result), /private.png: could not be downloaded safely/);
  assert.deepEqual(files(result), []);
});

test("markdown image links drop the closing delimiter and sentence punctuation", async () => {
  for (const message of [
    (url) => `See [image](${url}) here`,
    (url) => `See [image](${url}).`,
    (url) => `See [image](${url}), and more`,
  ]) {
    const h = harness();
    const signed = "https://files.example.test/screenshot.png?token=fixture";
    const result = await h.send({ message: message(signed) });
    assert.deepEqual(h.downloads.map(({ url }) => url), [signed]);
    assert.equal(files(result).length, 1);
  }
});
