// HTPR-6264: a HEIC must reach storage twice, as itself and as a JPEG copy,
// and only the original may come back as an attachment URL.
//
// This drives the real browser upload path with the network stubbed, because
// the interesting part is not the conversion (covered in heic-to-jpeg.test.ts)
// but the choreography around it: what the handshake asks for, what is PUT,
// which URLs are returned and what gets cleaned up when something fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.SESSION_SECRET ||= "heic-dual-upload-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { uploadFilesViaApi } = jiti(
  path.join(root, "src/lib/storage/uploadViaApi.ts")
);
const { parseRequestedFiles } = jiti(
  path.join(root, "src/pages/api/tasks/uploadUrl.ts")
);
const { HEIC_PREVIEW_SUFFIX } = jiti(
  path.join(root, "src/lib/media/heicPreview.ts")
);
const { planUploadFile } = jiti(path.join(root, "src/lib/media/heicToJpeg.ts"));
const axios = require("axios");

const STORAGE = "https://files.example.com";

/**
 * Stands in for `/api/tasks/uploadUrl` and `/api/tasks/uploadFinalize`,
 * deriving preview keys the same way the real route does so the test asserts
 * against the actual convention rather than a restatement of it.
 */
function stubUploadApi({ failKeys = [] } = {}) {
  const original = axios.post;
  const handshakes = [];
  const finalized = [];

  axios.post = async (url, body) => {
    if (url === "/api/tasks/uploadUrl") {
      handshakes.push(body);
      const keys = [];
      body.files.forEach((file, index) => {
        keys[index] =
          file.previewOfIndex === undefined
            ? `attachments/key${index}_${file.name}`
            : `${keys[file.previewOfIndex]}${HEIC_PREVIEW_SUFFIX}`;
      });
      return {
        data: {
          success: true,
          grant: "grant",
          uploads: body.files.map((file, index) => ({
            uploadUrl: `${STORAGE}/put/${keys[index]}`,
            key: keys[index],
            fileUrl: `${STORAGE}/${keys[index]}`,
            contentType:
              file.previewOfIndex === undefined ? file.type : "image/jpeg",
            fileName: file.name,
          })),
        },
      };
    }
    if (url === "/api/tasks/uploadFinalize") {
      finalized.push(body);
      return { data: { success: true } };
    }
    throw new Error(`unexpected POST to ${url}`);
  };

  const originalXhr = global.XMLHttpRequest;
  const put = [];
  global.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
    }
    open(method, url) {
      this.url = url;
    }
    setRequestHeader(name, value) {
      if (name === "Content-Type") this.contentType = value;
    }
    send() {
      put.push({ url: this.url, contentType: this.contentType });
      if (failKeys.some((key) => this.url.includes(key))) {
        this.status = 500;
        this.onerror?.();
        return;
      }
      this.status = 200;
      this.onload?.();
    }
  };

  return {
    handshakes,
    finalized,
    put,
    restore() {
      axios.post = original;
      global.XMLHttpRequest = originalXhr;
    },
  };
}

/** A file the converter stub will turn into a JPEG, without a real decoder. */
function heicFile(name = "IMG_4821.HEIC") {
  return new File([Buffer.from("heic-bytes")], name, { type: "image/heic" });
}

/**
 * Decides the file's plan up front with a stub decoder, so the upload path runs
 * without libheif, which needs a DOM and a wasm runtime Node does not have.
 *
 * This is also what production does: the file is planned when it is picked, so
 * the tray can show a thumbnail, and the upload layer reuses that same decode
 * rather than paying for it twice.
 */
async function planWithStubDecoder(file, { succeeds = true } = {}) {
  await planUploadFile(file, {
    loadConverter: async () => ({
      default: async () => {
        if (!succeeds) throw new Error("libheif failed to load");
        return new Blob([Buffer.from("jpeg-bytes")], { type: "image/jpeg" });
      },
    }),
  });
  return file;
}

test("a HEIC uploads twice and only the original comes back as the attachment", async () => {
  const api = stubUploadApi();
  try {
    const urls = await uploadFilesViaApi([await planWithStubDecoder(heicFile())]);

    // The handshake declares the pairing; the server derives the key from it.
    const [handshake] = api.handshakes;
    assert.equal(handshake.files.length, 2);
    assert.equal(handshake.files[0].name, "IMG_4821.HEIC");
    assert.equal(handshake.files[0].previewOfIndex, undefined);
    assert.equal(handshake.files[1].previewOfIndex, 0);

    // Both objects really are sent, and the copy is stored as a JPEG.
    assert.equal(api.put.length, 2);
    assert.ok(api.put[1].url.endsWith(HEIC_PREVIEW_SUFFIX));
    assert.equal(api.put[1].contentType, "image/jpeg");

    // The attachment is the photo the user picked. Returning the preview here
    // is the HTPR-6257 bug this ticket exists to undo.
    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_IMG_4821.HEIC`]);
    assert.ok(!urls[0].endsWith(HEIC_PREVIEW_SUFFIX));
  } finally {
    api.restore();
  }
});

test("a preview that will not upload never fails the photo", async () => {
  // The copy is a convenience. Losing it costs a thumbnail; losing the upload
  // costs the user their photo, so the two must not share a fate.
  const api = stubUploadApi({ failKeys: [HEIC_PREVIEW_SUFFIX] });
  try {
    const urls = await uploadFilesViaApi([await planWithStubDecoder(heicFile())]);
    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_IMG_4821.HEIC`]);

    // The abandoned preview must not be claimed as stored, or the finalize call
    // would ask the server to verify an object that was never written.
    const [finalize] = api.finalized;
    assert.ok(!finalize.keep.some((key) => key.endsWith(HEIC_PREVIEW_SUFFIX)));
  } finally {
    api.restore();
  }
});

test("an ordinary image is still a single upload with no preview", async () => {
  const api = stubUploadApi();
  try {
    const png = new File([Buffer.from("png")], "shot.png", { type: "image/png" });
    const urls = await uploadFilesViaApi([png]);
    assert.equal(api.handshakes[0].files.length, 1);
    assert.equal(api.put.length, 1);
    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_shot.png`]);
  } finally {
    api.restore();
  }
});

test("the handshake refuses a preview reference it cannot derive a key from", () => {
  // `previewOfIndex` decides where bytes land, so it is the one field a caller
  // could use to aim an upload somewhere it was not issued. It may only point
  // backwards, at a real entry, that is not itself a preview.
  const heic = { name: "IMG.heic", size: 10, type: "image/heic" };
  const preview = (index) => ({
    name: "IMG.heic.jpg",
    size: 5,
    type: "image/jpeg",
    previewOfIndex: index,
  });

  assert.doesNotThrow(() =>
    parseRequestedFiles({ files: [heic, preview(0)] })
  );
  // Forward reference: the key it names does not exist yet.
  assert.throws(() => parseRequestedFiles({ files: [preview(1), heic] }), /preview/i);
  // Out of range, and pointing at itself.
  assert.throws(() => parseRequestedFiles({ files: [heic, preview(9)] }), /preview/i);
  assert.throws(() => parseRequestedFiles({ files: [preview(0)] }), /preview/i);
  // A preview of a preview would compound the suffix.
  assert.throws(
    () => parseRequestedFiles({ files: [heic, preview(0), preview(1)] }),
    /preview/i
  );
  // Two previews of one original would sign the same key twice, and the second
  // PUT would silently overwrite the first.
  assert.throws(
    () => parseRequestedFiles({ files: [heic, preview(0), preview(0)] }),
    /Duplicate preview/
  );
});
