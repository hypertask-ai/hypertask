const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const guide = read("openwiki/style-guide.md");
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
    assert.ok(guide.includes(heading), `missing ${heading}`);
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

  assert.match(composer, /rounded-\[5px\] bg-cardBackground/);
  assert.match(composer, /px-\[12px\] pb-\[6px\]/);
  assert.match(composer, /rounded-lg bg-newcomment-well px-\[12px\] py-\[4px\]/);
  assert.match(attachments, /Paperclip size=\{16\}/);
  assert.match(attachments, /<SendArrow size=\{22\}/);
  assert.match(general, /min-h-\[44px\] min-w-\[44px\]/);
});

test("the long-form design reference points to the canonical guide", () => {
  const design = read("docs/DESIGN.md");
  assert.match(design, /canonical visual contract.*openwiki\/style-guide\.md/i);
  assert.doesNotMatch(design, /single source of truth for what Hypertask looks like/i);
});
