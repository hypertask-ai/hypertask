import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBlockHtml } from '../normalizeBlockHtml'

test('wraps bare text and preserves inline HTML', () => {
  assert.equal(normalizeBlockHtml('hello world'), '<p>hello world</p>')
  assert.equal(
    normalizeBlockHtml('has <strong>bold</strong> text'),
    '<p>has <strong>bold</strong> text</p>'
  )
})

test('converts single newlines and splits repeated newlines into paragraphs', () => {
  assert.equal(normalizeBlockHtml('line1\nline2'), '<p>line1<br>line2</p>')
  assert.equal(normalizeBlockHtml('para1\n\npara2'), '<p>para1</p><p>para2</p>')
  assert.equal(normalizeBlockHtml('line1\r\nline2'), '<p>line1<br>line2</p>')
})

test('splits repeated br tags while preserving single br tags', () => {
  assert.equal(normalizeBlockHtml('para1<br><br>para2'), '<p>para1</p><p>para2</p>')
  assert.equal(normalizeBlockHtml('para1<br /> \n <BR/>para2'), '<p>para1</p><p>para2</p>')
  assert.equal(normalizeBlockHtml('line1<br>line2'), '<p>line1<br>line2</p>')
})

test('returns block HTML and blank input unchanged', () => {
  assert.equal(normalizeBlockHtml('<p>already wrapped</p>'), '<p>already wrapped</p>')
  assert.equal(normalizeBlockHtml('<ul><li>x</li></ul>'), '<ul><li>x</li></ul>')
  assert.equal(normalizeBlockHtml('<SECTION>content</SECTION>'), '<SECTION>content</SECTION>')
  assert.equal(normalizeBlockHtml(''), '')
  assert.equal(normalizeBlockHtml('  \r\n '), '  \r\n ')
})
