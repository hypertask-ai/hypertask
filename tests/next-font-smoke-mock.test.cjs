const test = require("node:test");
const assert = require("node:assert/strict");

const mock = require("../scripts/next-font-smoke-mock.cjs");
const {
  getFontAxes,
} = require("next/dist/compiled/@next/font/dist/google/get-font-axes.js");
const {
  getGoogleFontsUrl,
} = require("next/dist/compiled/@next/font/dist/google/get-google-fonts-url.js");

const DECLARATIONS = [
  { family: "Newsreader", weights: ["400", "500"], styles: ["normal", "italic"] },
  { family: "IBM Plex Mono", weights: ["700"], styles: ["normal"] },
  { family: "Inter", weights: ["variable"], styles: ["normal"] },
  { family: "Newsreader", weights: ["variable"], styles: ["normal", "italic"] },
  { family: "IBM Plex Sans", weights: ["variable"], styles: ["normal"] },
];

test("the smoke font mock is a JSON map, not a live object", () => {
  assert.equal(Object.getPrototypeOf(mock), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(mock)), mock);
});

test("the smoke font mock answers every Google Fonts stylesheet the app asks for", () => {
  for (const { family, weights, styles } of DECLARATIONS) {
    const axes = getFontAxes(family, weights, styles);
    const url = getGoogleFontsUrl(family, axes, "swap");
    assert.equal(typeof mock[url], "string", `missing mocked response for ${url}`);
    assert.match(mock[url], /@font-face/);
  }
});
