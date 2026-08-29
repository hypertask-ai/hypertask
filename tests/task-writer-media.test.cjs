const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTypeScriptModule(filePath, localRequire = require) {
  const source = fs.readFileSync(filePath, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    loaded,
    loaded.exports,
    localRequire
  );
  return loaded.exports;
}

const imageUrlModule = loadTypeScriptModule(
  path.join(__dirname, "../src/lib/media/isImageUrl.ts")
);
const loaded = {
  exports: loadTypeScriptModule(
    path.join(__dirname, "../src/lib/ai/taskWriterMedia.ts"),
    (specifier) =>
      specifier === "@/lib/media/isImageUrl"
        ? imageUrlModule
        : require(specifier)
  ),
};

const {
  createTaskWriterMediaTokenFactory,
  extractTaskWriterPromptMedia,
  extractTaskWriterMedia,
  maskTaskWriterMedia,
  restoreTaskWriterMedia,
} = loaded.exports;

test("turns a pasted image URL into restorable Task Writer media", () => {
  const input =
    "Create a task from this image:\nhttps://screencast2.com/KXOVa.png";
  const extracted = extractTaskWriterPromptMedia(input);

  assert.equal(
    extracted.html,
    "Create a task from this image:\n[[HT_MEDIA_1]]"
  );
  assert.deepEqual(extracted.media, [
    {
      token: "[[HT_MEDIA_1]]",
      html: '<a target="_blank" rel="noopener noreferrer nofollow" href="https://screencast2.com/KXOVa.png">https://screencast2.com/KXOVa.png</a><br><img src="https://screencast2.com/KXOVa.png" media-type="img" width="100%" height="auto" dataalign="left" loading="lazy">',
    },
  ]);
  assert.equal(
    restoreTaskWriterMedia("<p>Generated task</p>", extracted.media),
    `<p>Generated task</p>${extracted.media[0].html}`
  );
});

test("does not unfurl an image URL embedded in prose", () => {
  const input = "Use https://cdn.example.com/reference.png as background context.";

  assert.deepEqual(extractTaskWriterPromptMedia(input), {
    html: input,
    media: [],
  });
});

test("escapes image URLs before restoring them as HTML", () => {
  const input =
    'https://cdn.example.com/reference.png?caption="<draft>"&version=1';
  const extracted = extractTaskWriterPromptMedia(input);

  assert.equal(
    extracted.media[0].html,
    '<a target="_blank" rel="noopener noreferrer nofollow" href="https://cdn.example.com/reference.png?caption=&quot;&lt;draft&gt;&quot;&amp;version=1">https://cdn.example.com/reference.png?caption=&quot;&lt;draft&gt;&quot;&amp;version=1</a><br><img src="https://cdn.example.com/reference.png?caption=&quot;&lt;draft&gt;&quot;&amp;version=1" media-type="img" width="100%" height="auto" dataalign="left" loading="lazy">'
  );
});

test("keeps prompt media tokens distinct from description media", () => {
  const description = extractTaskWriterMedia(
    '<p>Existing</p><img src="https://cdn.example.com/existing.png">'
  );
  const promptHtml = extractTaskWriterMedia(
    '<p>Previous response <img src="https://cdn.example.com/previous.png"></p>',
    description.media.length
  );
  const promptUrl = extractTaskWriterPromptMedia(
    `${promptHtml.html}\nhttps://cdn.example.com/current.png`,
    description.media.length + promptHtml.media.length
  );

  assert.deepEqual(
    [...description.media, ...promptHtml.media, ...promptUrl.media].map(
      ({ token }) => token
    ),
    ["[[HT_MEDIA_1]]", "[[HT_MEDIA_2]]", "[[HT_MEDIA_3]]"]
  );
});

test("preserves literal media-token text beside a pasted image URL", () => {
  const prompt = "[[HT_MEDIA_1]]\nhttps://cdn.example.com/current.png";
  const nextToken = createTaskWriterMediaTokenFactory(prompt);
  const extracted = extractTaskWriterPromptMedia(prompt, nextToken);

  assert.equal(extracted.media[0].token, "[[HT_MEDIA_2]]");
  assert.equal(
    restoreTaskWriterMedia(extracted.html, extracted.media),
    `[[HT_MEDIA_1]]\n${extracted.media[0].html}`
  );
});

test("reserves media-token text from every request context source", () => {
  const nextToken = createTaskWriterMediaTokenFactory(
    "[[HT_MEDIA_1]]",
    "[[HT_MEDIA_2]]",
    "[[HT_MEDIA_3]]"
  );

  assert.equal(nextToken(), "[[HT_MEDIA_4]]");
});

test("preserves editor media in place", () => {
  const input =
    '<p>Before</p><div class="video-wrapper"><iframe src="https://www.loom.com/embed/demo" allowfullscreen></iframe></div><p>Between <img src="https://cdn.example.com/image.png" alt="demo"> after</p><video controls><source src="https://cdn.example.com/demo.mp4"></video>';
  const extracted = extractTaskWriterMedia(input);

  assert.equal(
    extracted.html,
    "<p>Before</p>[[HT_MEDIA_1]]<p>Between [[HT_MEDIA_2]] after</p>[[HT_MEDIA_3]]"
  );
  assert.equal(maskTaskWriterMedia(input, extracted.media), extracted.html);
  assert.equal(restoreTaskWriterMedia(extracted.html, extracted.media), input);
});

test("re-appends media tokens the model dropped", () => {
  const input = '<p>Before</p><img src="https://cdn.example.com/image.png">';
  const extracted = extractTaskWriterMedia(input);

  assert.equal(
    restoreTaskWriterMedia("<p>Rewritten</p>", extracted.media),
    '<p>Rewritten</p><img src="https://cdn.example.com/image.png">'
  );
});

test("keeps unrecognized media-token text while deduplicating known media", () => {
  const input = '<p>Before</p><iframe src="https://www.figma.com/embed/demo"></iframe>';
  const extracted = extractTaskWriterMedia(input);

  assert.equal(
    restoreTaskWriterMedia(
      "<p>Rewritten</p>[[HT_MEDIA_1]][[HT_MEDIA_1]][[HT_MEDIA_999]]",
      extracted.media
    ),
    `${input.replace("<p>Before</p>", "<p>Rewritten</p>")}[[HT_MEDIA_999]]`
  );
});

test("passes a description without media through byte-identical", () => {
  const input = '<p class="copy">Plain &amp; unchanged.</p>\n<ul><li>One</li></ul>';
  const extracted = extractTaskWriterMedia(input);

  assert.equal(extracted.html, input);
  assert.deepEqual(extracted.media, []);
  assert.equal(restoreTaskWriterMedia(extracted.html, extracted.media), input);
});
