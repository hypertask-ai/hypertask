import assert from "node:assert/strict";
import {
  getExplicitLevel,
  resolveLevel,
  youtubeThumbnailUrl,
} from "./model";

assert.equal(
  youtubeThumbnailUrl("https://www.youtube.com/embed/L62LY5lIKCo?controls=0"),
  "https://img.youtube.com/vi/L62LY5lIKCo/mqdefault.jpg"
);
assert.equal(youtubeThumbnailUrl("https://x.test/shot.png"), null);
assert.equal(youtubeThumbnailUrl(undefined), null);

for (const level of ["note", "link", "video", "banner", "takeover"] as const) {
  assert.equal(resolveLevel({ level }), level);
  assert.equal(getExplicitLevel({ level }), level);
}

assert.equal(resolveLevel({ slides: [{} as never] }), "takeover");
assert.equal(resolveLevel({ blogURL: "https://hypertask.ai" }), "link");
assert.equal(
  resolveLevel({ blogURL: "https://hypertask.ai", slides: [{} as never] }),
  "link"
);
assert.equal(resolveLevel({}), "note");
assert.equal(getExplicitLevel({ slides: [{} as never] }), undefined);
assert.equal(getExplicitLevel({ level: "nonsense" as never }), undefined);

console.log("announcement level self-check ok");
