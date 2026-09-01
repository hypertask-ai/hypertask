const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const guide = read("openwiki/style-guide.md");
const guideLines = guide.split(/\r?\n/);
const themeNames = ["amoled", "graphite", "porcelain", "dia"];
const themes = Object.fromEntries(
  themeNames.map((theme) => [
    theme,
    read(`src/styles/tailwindThemes/${theme}.css`).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    ),
  ]),
);

function themeValue(theme, variable) {
  const match = themes[theme].match(
    new RegExp(`${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`),
  );
  assert.ok(match, `${variable} must exist in ${theme}.css`);
  return match[1].trim();
}

function markdownRow(label, utility, variable) {
  const values = themeNames.map((theme) => `\`${themeValue(theme, variable)}\``);
  return `| ${label} | \`${utility}\` | \`${variable}\` | ${values.join(" | ")} |`;
}

test("the style guide carries every required visual contract section", () => {
  for (const heading of [
    "## Shape and borders",
    "## Color tokens",
    "## Spacing",
    "## Typography",
    "## Icons",
    "## Button hierarchy",
    "## Reference implementation: mobile comment field",
    "## Pull request review contract",
  ]) {
    assert.ok(guideLines.includes(heading), `missing ${heading}`);
  }
});

test("the style guide theme matrix matches production token values", () => {
  const rows = [
    ["Page", "bg-pageBackground", "--bg-pageBackground"],
    ["Card", "bg-cardBackground", "--bg-cardBackground"],
    ["Modal or menu", "bg-modalBackground", "--bg-modalBackground"],
    ["Comment surface", "bg-comment-description", "--bg-comment-description"],
    ["Mobile comment well", "bg-newcomment-well", "--bg-newcomment-well"],
    ["Primary text", "text-white-black", "--color-white-black"],
    ["Muted text", "text-text-light-gray", "--color-text-light-gray"],
    ["Quiet border", "border-border-light-gray-thin", "--border-light-gray-thin"],
    ["Primary action", "bg-shadcn-primary", "--shadcn-primary"],
  ];

  for (const row of rows) {
    assert.ok(guide.includes(markdownRow(...row)), `stale style-guide row: ${row[0]}`);
  }
});

test("the documented typography scale matches Tailwind configuration", () => {
  const tailwind = read("tailwind.config.ts");
  const sizes = {
    micro: "11px",
    meta: "12px",
    dense: "13px",
    content: "14px",
    emphasis: "16px",
    subheading: "18px",
    heading: "24px",
    display: "32px",
  };

  for (const [name, value] of Object.entries(sizes)) {
    assert.match(tailwind, new RegExp(`"${name}"\\s*:\\s*"${value}"`));
    assert.ok(
      guide.includes(`| \`text-${name}\` | ${value} |`),
      `style guide must document text-${name}`,
    );
  }
});

test("the reference composer still implements the documented geometry", () => {
  const composer = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx",
  );
  const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
  const general = read("src/lib/configs/general.config.ts");

  const classesContaining = (source, token) => {
    const match = [...source.matchAll(/className="([^"]*)"/g)].find((entry) =>
      entry[1].split(/\s+/).includes(token),
    );
    assert.ok(match, `missing className containing ${token}`);
    return new Set(match[1].split(/\s+/));
  };

  const shellClasses = classesContaining(composer, "fixed");
  assert.ok(shellClasses.has("bg-transparent"));
  assert.equal(shellClasses.has("bg-cardBackground"), false);

  const paddingClasses = classesContaining(composer, "pb-[6px]");
  assert.ok(paddingClasses.has("px-[12px]"));

  const wellClasses = classesContaining(composer, "rounded-[8px]");
  for (const token of [
    "border",
    "border-comment-description-border",
    "bg-cardBackground",
    "px-[12px]",
    "py-[4px]",
  ]) {
    assert.ok(wellClasses.has(token), `comment well missing ${token}`);
  }

  const commentActions = attachments.slice(
    attachments.indexOf('aria-label="More comment actions"'),
    attachments.indexOf("<AudioButton", attachments.indexOf('aria-label="More comment actions"')),
  );
  assert.match(commentActions, /<Plus\b[^>]*\bsize=\{20\}[^>]*>/);
  assert.match(commentActions, /Attach image[\s\S]*Attach file[\s\S]*Mention someone[\s\S]*Commands[\s\S]*Discard draft/);

  const commentSendStart = attachments.indexOf(
    '{mode === "create-comment" ? (',
    attachments.indexOf("const SaveButtonMobile"),
  );
  const commentSendEnd = attachments.indexOf(
    ') : mode === "create-task-modal"',
    commentSendStart,
  );
  assert.notEqual(commentSendStart, -1, "missing mobile comment send branch");
  assert.notEqual(commentSendEnd, -1, "missing mobile comment send boundary");
  const commentSend = attachments.slice(commentSendStart, commentSendEnd);
  assert.match(commentSend, /aria-label="Send comment"/);
  assert.match(commentSend, /<SendArrow\b[^>]*\bsize=\{22\}[^>]*>/);

  const mobileTarget = general.match(
    /export const MOBILE_TARGET\s*=\s*"([^"]+)";/,
  );
  assert.ok(mobileTarget, "missing MOBILE_TARGET declaration");
  const mobileTargetClasses = new Set(mobileTarget[1].split(/\s+/));
  assert.ok(mobileTargetClasses.has("min-h-[44px]"));
  assert.ok(mobileTargetClasses.has("min-w-[44px]"));
});

test("the long-form design reference points to the canonical guide", () => {
  const design = read("docs/DESIGN.md");
  assert.match(design, /canonical visual contract.*openwiki\/style-guide\.md/i);
  assert.doesNotMatch(design, /single source of truth for what Hypertask looks like/i);
});
