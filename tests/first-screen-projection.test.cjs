const assert = require('node:assert/strict');
const test = require('node:test');
require('tsx/cjs');
const { JSDOM } = require('jsdom');
const { format } = require('date-fns');
const { projectDisplayDate, projectDisplayDay } = require('../src/lib/firstScreen/display.ts');
const { projectCommentPreview, projectPlainText } = require('../src/lib/firstScreen/comment.ts');
const { daysSince } = require('../src/lib/staleness.ts');
const formatDateDifference = require('../src/utils/generateTime.ts').default;
const { formatDateWithYearIfPast } = require('../src/utils/generateTime.ts');
const now = '2026-01-01T00:30:00.000Z';

test('date projections match existing formatting across timezones, locales and year boundaries', () => {
  const OriginalDate = Date;
  const originalTZ = process.env.TZ;
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { throw new Error('Implicit clock'); }
  };
  try {
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Asia/Kathmandu', 'Pacific/Auckland']) {
      process.env.TZ = timeZone;
      const clock = Object.freeze({ now, display: Object.freeze({ timeZone, locale: 'en-US' }) });
      for (const delta of [-30_000, -90_000, -3_600_000, -43_200_000, -86_400_000, -400 * 86_400_000, 86_400_000]) {
        const date = new Date(OriginalDate.parse(now) + delta);
        const year = date.getFullYear() === new Date().getFullYear();
        assert.equal(projectDisplayDate(date, clock), formatDateDifference(date), `${timeZone} ${date.toISOString()}`);
        assert.equal(projectDisplayDate(date, clock, 'due'), format(date, year ? 'LLL dd' : 'LLL dd, y'));
        assert.equal(projectDisplayDate(date, clock, 'changed'), format(date, year ? 'dd MMM' : 'dd MMM yyyy'));
        assert.equal(projectDisplayDate(date, clock, 'created'), formatDateWithYearIfPast(date));
        assert.equal(projectDisplayDate(date.toISOString(), clock), projectDisplayDate(date, clock));
      }
      assert.equal(projectDisplayDay(clock), new Date().getDate());
      for (const locale of ['en-GB', 'de-DE', 'sv-SE']) {
        const display = { ...clock.display, locale };
        const date = new Date('2025-05-02T03:00:00.000Z');
        assert.equal(projectDisplayDate(date, { now, display }, 'created'), date.toLocaleDateString(locale, { timeZone, day: '2-digit', month: 'short', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }));
      }
      assert.equal(projectDisplayDate('bad', clock), '');
      assert.equal(projectDisplayDate(null, clock), '');
      assert.equal(daysSince('2025-12-01T00:30:00.000Z', OriginalDate.parse(now)), 31);
      assert.equal(daysSince('2027-12-01T00:30:00.000Z', OriginalDate.parse(now)), 0);
      assert.equal(daysSince(null, OriginalDate.parse(now)), null);
    }
    // Runtime timezone changes cannot influence an explicitly scoped display.
    const clock = { now, display: { timeZone: 'America/Los_Angeles', locale: 'en-US' } };
    const result = projectDisplayDate(now, clock, 'due');
    process.env.TZ = 'Asia/Kathmandu';
    assert.equal(projectDisplayDate(now, clock, 'due'), result);
    assert.equal(projectDisplayDay(clock), 31);
  } finally {
    global.Date = OriginalDate;
    if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
  }
});

function legacyPreview(document, html, userId) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const fullText = div.textContent || '';
  div.querySelectorAll('blockquote').forEach(node => node.remove());
  div.querySelectorAll('p').forEach(paragraph => {
    const mentions = paragraph.querySelectorAll('span[data-type="mention"]');
    const mention = mentions[0];
    if (!mention || mentions.length !== 1 || paragraph.children.length !== 1 || paragraph.firstElementChild !== mention) return;
    const mentionText = mention.textContent?.trim() ?? '';
    if (mentionText && paragraph.textContent.trim().replace(/:$/, '').trim() === `${mentionText} said`) paragraph.remove();
  });
  const mention = userId === undefined ? null : div.querySelector(`span[data-type="mention"][data-label="name-${userId}"]`);
  if (!mention) return { text: div.textContent.trim() || fullText, mention: null };
  const name = mention.textContent;
  const parent = mention.parentElement.textContent;
  const index = parent.indexOf(name);
  return { text: parent, mention: { before: parent.slice(0, index), name, after: parent.slice(index + name.length) } };
}

test('pure comment projection matches browser text, quoted-content removal and mention markup inputs', () => {
  const dom = new JSDOM('');
  const document = dom.window.document;
  try {
    const mention = '<span data-type="mention" data-label="name-985">QA &amp; team</span>';
    for (const html of ['', '<p>Hello &amp; goodbye&nbsp;👋</p>', '<p>A<br>B</p><p>C</p>',
      `<p>Before ${mention} after</p>`, `<p>${mention} said:</p><blockquote><p>old</p></blockquote><p>new</p>`,
      `<blockquote>${mention}</blockquote>`, `<p>${mention} and ${mention}</p>`, '<!--comment--><p>&lt;safe&gt;</p>',
      '<p>Unicode &#x1F60A; &#169;</p>', '<p>unfinished <strong>bold</strong></p>']) {
      for (const userId of [undefined, 985, 7]) {
        const input = Object.freeze({ html, userId });
        assert.deepEqual(projectCommentPreview(input.html, input.userId), legacyPreview(document, html, userId), html);
        assert.deepEqual(projectCommentPreview(input.html, input.userId), projectCommentPreview(input.html, input.userId));
      }
      const div = document.createElement('div'); div.innerHTML = html;
      assert.equal(projectPlainText(html), div.textContent);
    }
    const original = global.document;
    delete global.document;
    try { assert.equal(projectCommentPreview('<p>Server text</p>').text, 'Server text'); }
    finally { if (original !== undefined) global.document = original; }
  } finally { dom.window.close(); }
});
