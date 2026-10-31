const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/attachment-mime-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const { getFileTypeFromUrl, IMAGE_FALLBACK_MIME } = loadTs(
  "src/utils/helperFunctions/getFileTypeFromUrl.ts"
);


test("MIME type comes from the extension, so no network call is needed", () => {
  assert.equal(
    getFileTypeFromUrl("https://files.hypertask.app/tasks/attachments/1_bands.png"),
    "image/png"
  );
  assert.equal(getFileTypeFromUrl("https://x/a/b/shot.JPG"), "image/jpeg");
  assert.equal(getFileTypeFromUrl("https://x/a/photo.avif"), "image/avif");
  assert.equal(getFileTypeFromUrl("https://x/a/spec.pdf"), "application/pdf");
  assert.equal(
    getFileTypeFromUrl("https://x/a/notes.docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
});

test("query strings and fragments do not hide the extension", () => {
  assert.equal(
    getFileTypeFromUrl("https://files.hypertask.app/a/b.png?v=2&sig=abc"),
    "image/png"
  );
  assert.equal(getFileTypeFromUrl("https://files.hypertask.app/a/b.png#frag"), "image/png");
});

test("an img-tag URL with no usable extension still claims an image type", () => {
  assert.equal(IMAGE_FALLBACK_MIME.startsWith("image/"), true);
  for (const url of [
    "https://files.hypertask.app/tasks/attachments/1_screenshot",
    "https://files.hypertask.app/tasks/attachments/1_thing.unknownext",
    "https://files.hypertask.app/v1.2/screenshot",
    "",
  ]) {
    assert.equal(
      getFileTypeFromUrl(url, IMAGE_FALLBACK_MIME),
      IMAGE_FALLBACK_MIME,
      `${url || "(empty)"} must stay an image so it is not silently dropped`
    );
  }
});

test("without an explicit fallback an unknown extension degrades, it does not throw", () => {
  assert.equal(getFileTypeFromUrl("https://x/a/file.weird"), "application/octet-stream");
  assert.equal(getFileTypeFromUrl("https://x/a/noextension"), "application/octet-stream");
});

const HOSTED_ATTACHMENT_CALLERS = [
  "src/hooks/MultiPages/AiWriter/useAiTaskWriter.ts",
  "src/utils/helperFunctions/helperFunctions.ts",
];

test("hosted attachments resolve their type from the URL and never over the network", () => {
  for (const relativePath of HOSTED_ATTACHMENT_CALLERS) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const fromLoop = source.slice(source.indexOf("const url = img.src;"));
    const hostedBranch = fromLoop.slice(0, fromLoop.indexOf("} else"));
    assert.ok(hostedBranch.length > 0, `${relativePath}: hosted-attachment branch not found`);

    assert.match(
      hostedBranch,
      /getFileTypeFromUrl\(\s*url\s*,\s*IMAGE_FALLBACK_MIME\s*\)/,
      `${relativePath} must type hosted attachments from the URL, with the image fallback`
    );
    assert.doesNotMatch(
      hostedBranch,
      /\b(blobToBase64|fetch)\s*\(/,
      `${relativePath} fetches the attachment again, which CORS blocks in the browser`
    );
  }
});
