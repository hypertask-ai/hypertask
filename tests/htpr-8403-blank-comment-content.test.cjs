const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');
const { setup } = require('./helpers/comment-routing.cjs');

const { hasVisibleContent } = loadModule('src/lib/mcp/comments/contentPresence.ts');

test('text that only survives as tags or invisible entities is blank', () => {
  for (const blank of ['<p></p>', '<p><br></p>', '<p> </p>', '&nbsp;', '<p>&nbsp;</p>', '<p>\u200b</p>', '<div><span> </span></div>', '<p>&#160;</p>', '<p>&#32;</p>', '<p>&#x20;</p>', '<figure></figure>']) {
    assert.equal(hasVisibleContent(blank), false, `${JSON.stringify(blank)} must be blank`);
  }
});

test('real text, mentions and media count as content', () => {
  for (const filled of ['<p>hi</p>', '<p>&amp;</p>', '<p><strong>ok</strong></p>', '<p><span data-type="mention">Valentin Yeo</span></p>', '<p><img src="https://example.com/a.png"></p>', '<p><img src="https://example.com/a.png"> caption</p>']) {
    assert.equal(hasVisibleContent(filled), true, `${JSON.stringify(filled)} must count as content`);
  }
});

test('comment add refuses a body whose HTML renders nothing', async () => {
  const { post, calls } = setup();
  const refused = await post({ text: '<p>&nbsp;</p>' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'Comment text is required');
  assert.equal(calls.comments.length, 0);
});

test('comment add still posts a body with real text', async () => {
  const { post, calls } = setup({ flag: false });
  const created = await post({ text: '<p>Progress &amp; next step</p>' });
  assert.equal(created.status, 201);
  assert.equal(calls.comments.length, 1);
});
