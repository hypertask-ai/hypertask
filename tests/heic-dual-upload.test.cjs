const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.SESSION_SECRET ||= "heic-dual-upload-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: {
    "@": path.join(root, "src"),
  },
});

const { uploadFilesViaApi } = jiti(
  path.join(root, "src/lib/storage/uploadViaApi.ts")
);
const { parseRequestedFiles } = jiti(
  path.join(root, "src/lib/api/task-writes/upload-url.ts")
);
const { HEIC_PREVIEW_SUFFIX } = jiti(
  path.join(root, "src/lib/media/heicPreview.ts")
);
const { planUploadFile } = jiti(path.join(root, "src/lib/media/heicToJpeg.ts"));
const axios = require("axios");

const STORAGE = "https://files.example.com";

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

function heicFile(name = "IMG_4821.HEIC") {
  return new File([Buffer.from("heic-bytes")], name, { type: "image/heic" });
}

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

    const [handshake] = api.handshakes;
    assert.equal(handshake.files.length, 2);
    assert.equal(handshake.files[0].name, "IMG_4821.HEIC");
    assert.equal(handshake.files[0].previewOfIndex, undefined);
    assert.equal(handshake.files[1].previewOfIndex, 0);

    assert.equal(api.put.length, 2);
    assert.ok(api.put[1].url.endsWith(HEIC_PREVIEW_SUFFIX));
    assert.equal(api.put[1].contentType, "image/jpeg");

    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_IMG_4821.HEIC`]);
    assert.ok(!urls[0].endsWith(HEIC_PREVIEW_SUFFIX));
  } finally {
    api.restore();
  }
});

test("a preview that will not upload never fails the photo", async () => {
  const api = stubUploadApi({ failKeys: [HEIC_PREVIEW_SUFFIX] });
  try {
    const urls = await uploadFilesViaApi([await planWithStubDecoder(heicFile())]);
    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_IMG_4821.HEIC`]);

    const [finalize] = api.finalized;
    assert.ok(!finalize.keep.some((key) => key.endsWith(HEIC_PREVIEW_SUFFIX)));
  } finally {
    api.restore();
  }
});

test("a photo no render site could resolve is uploaded alone", async () => {
  const api = stubUploadApi();
  try {
    const ftyp = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
    ]);
    const anonymous = new File([ftyp], "IMG_4821", { type: "" });
    const urls = await uploadFilesViaApi([
      await planWithStubDecoder(anonymous),
    ]);
    assert.equal(api.handshakes[0].files.length, 1);
    assert.equal(api.put.length, 1);
    assert.deepEqual(urls, [`${STORAGE}/attachments/key0_IMG_4821`]);
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
  assert.throws(() => parseRequestedFiles({ files: [preview(1), heic] }), /preview/i);
  assert.throws(() => parseRequestedFiles({ files: [heic, preview(9)] }), /preview/i);
  assert.throws(() => parseRequestedFiles({ files: [preview(0)] }), /preview/i);
  assert.throws(
    () => parseRequestedFiles({ files: [heic, preview(0), preview(1)] }),
    /preview/i
  );
  assert.throws(
    () => parseRequestedFiles({ files: [heic, preview(0), preview(0)] }),
    /Duplicate preview/
  );
});
