const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const { hasVisibleContent } = loadModule('src/lib/mcp/comments/contentPresence.ts');

const createRoute = fs.readFileSync(path.join(root, 'src/lib/mcp/operations/comments/operation.ts'), 'utf8').replace(/\s+/g, ' ');
const updateRoute = fs.readFileSync(path.join(root, 'src/lib/mcp/operations/comments/[comment_id]/operation.ts'), 'utf8').replace(/\s+/g, ' ');

test('whitespace that only survives sanitizing counts as blank', () => {
  for (const blank of ['<p></p>', '<p><br></p>', '<p> </p>', '&nbsp;', '<p>&nbsp;</p>', '<p>\u200b</p>', '<div><span> </span></div>', '<p>&#160;</p>', '<p>&#32;</p>', '<p>&#x20;</p>', '<figure></figure>']) {
    assert.equal(hasVisibleContent(blank), false, `${JSON.stringify(blank)} must be blank`);
  }
});

test('real text, mentions and media count as content', () => {
  for (const filled of ['<p>hi</p>', '<p>&amp;</p>', '<p><strong>ok</strong></p>', '<p><span data-type="mention">Valentin Yeo</span></p>', '<p><img src="https://example.com/a.png"></p>', '<p><img src="https://example.com/a.png"> caption</p>']) {
    assert.equal(hasVisibleContent(filled), true, `${JSON.stringify(filled)} must count as content`);
  }
});

test('comment update refuses content that renders nothing', () => {
  assert.match(
    updateRoute,
    /sanitizedText = normalizeBlockHtml\(sanitizedText\) if \(!hasVisibleContent\(sanitizedText\)\) \{ return NextResponse\.json\(/,
  );
});

test('comment add refuses content that renders nothing unless media or attachments carry it', () => {
  assert.match(
    createRoute,
    /sanitizedText = normalizeBlockHtml\(sanitizedText\) if \(!hasVisibleContent\(sanitizedText\) && \(images\?\.length \?\? 0\) === 0 && !hasImageAttachments && has_attachments !== true\) \{ return NextResponse\.json\(/,
  );
});
