const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const mockedResponses = require(path.join(__dirname, "..", "scripts", "next-font-smoke-mock.cjs"));

test("the font mock survives the JSON round trip Turbopack reads it through", () => {
  const decoded = JSON.parse(JSON.stringify(mockedResponses));
  assert.ok(
    Object.keys(decoded).length > 0,
    "Turbopack evaluates the mock and reads the URL-keyed map out of it, so a proxy or a getter " +
      "serialises to an empty map and every stylesheet request fails with `url not found`",
  );
  for (const [url, css] of Object.entries(decoded)) {
    assert.ok(url.startsWith("https://fonts.googleapis.com/css2?"), `unexpected stylesheet URL ${url}`);
    assert.equal(typeof css, "string");
    assert.ok(css.includes("src: local("), `stylesheet for ${url} must stay local`);
    assert.ok(
      !css.includes("url("),
      `stylesheet for ${url} must not reference a font file; the smoke build runs without network access`,
    );
  }
});

test("every font the app registers has a mocked stylesheet", () => {
  for (const family of ["Inter", "Newsreader", "IBM Plex Mono", "IBM Plex Sans"]) {
    const encoded = family.replaceAll(" ", "+");
    assert.ok(
      Object.keys(mockedResponses).some((url) => url.includes(`family=${encoded}`)),
      `no mocked stylesheet for ${family}`,
    );
  }
});
