const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')

const root = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src/app/search/search-autocomplete.css'), 'utf8')
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })
const config = load(path.join(root, 'tailwind.config.ts')).default
const { searchFilterColour } = load(path.join(root, 'src/lib/search/autocomplete.ts'))
const types = ['people', 'board', 'label', 'status', 'date', 'has']
const operators = ['from', 'in', 'label', 'is', 'after', 'has']
const light = {
  bg: ['#ede9fe', '#dbeafe', '#ffe4e6', '#d1fae5', '#fef3c7', '#cffafe'],
  border: ['#8b5cf6', '#3b82f6', '#f43f5e', '#10b981', '#f59e0b', '#06b6d4'],
}
const dark = {
  bg: ['#30283f', '#23334c', '#422a33', '#203b32', '#3a331f', '#20383e'],
  border: ['#a78bfa', '#60a5fa', '#fb7185', '#34d399', '#fbbf24', '#22d3ee'],
}

test('search semantic tokens retain all six palettes and apply only inside the flagged container', () => {
  for (const theme of ['light', 'dia', 'porcelain', 'dark', 'amoled', 'graphite']) {
    const dom = new JSDOM(`<style>${css}</style><div id="enabled" class="search-autocomplete"></div><div id="disabled"></div>`)
    try {
      dom.window.document.documentElement.className = theme
      const enabled = dom.window.getComputedStyle(dom.window.document.getElementById('enabled'))
      const disabled = dom.window.getComputedStyle(dom.window.document.getElementById('disabled'))
      const palette = ['dark', 'amoled', 'graphite'].includes(theme) ? dark : light
      for (const [index, type] of types.entries()) {
        for (const kind of ['bg', 'border']) {
          const token = `--${kind}-search-filter-${type}`
          assert.equal(enabled.getPropertyValue(token).trim(), palette[kind][index], `${theme} ${token}`)
          assert.equal(disabled.getPropertyValue(token), '', `${theme} flag off: ${token}`)
        }
      }
      assert.equal(enabled.getPropertyValue('--bg-search-highlight').trim(), 'var(--bg-mention-highlight)')
      assert.equal(disabled.getPropertyValue('--bg-search-highlight'), '')
    } finally { dom.window.close() }
  }
})

test('AMOLED search uses the true-black page token without changing other themes or containers', () => {
  const themeCss = ['amoled', 'dia', 'graphite', 'porcelain']
    .map((theme) => fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), 'utf8')).join('\n')
  const containerColour = config.theme.extend.backgroundColor.containerBackground
  for (const theme of ['amoled', 'graphite', 'porcelain', 'dia']) {
    const dom = new JSDOM(`<style>.bg-containerBackground { background-color: ${containerColour}; }\n${themeCss}\n${css}</style><div id="search" class="search-input bg-containerBackground"></div><div id="other" class="bg-containerBackground"></div>`)
    try {
      const document = dom.window.document
      document.documentElement.className = `${['amoled', 'graphite'].includes(theme) ? 'dark' : 'light'} ${theme}`
      for (const autocomplete of [false, true]) {
        document.getElementById('search').classList.toggle('search-autocomplete', autocomplete)
        const search = dom.window.getComputedStyle(document.getElementById('search'))
        assert.equal(search.backgroundColor, theme === 'amoled' ? 'var(--bg-pageBackground)' : containerColour, `${theme}, autocomplete ${autocomplete}`)
      }
      assert.equal(dom.window.getComputedStyle(document.getElementById('other')).backgroundColor, containerColour, `${theme}: unrelated containers are unchanged`)
      if (theme === 'amoled') {
        assert.equal(dom.window.getComputedStyle(document.documentElement).getPropertyValue('--bg-pageBackground').trim(), '#000000')
      }
    } finally { dom.window.close() }
  }
})

test('filter utilities and title highlighting resolve semantic theme variables, not Tailwind palette colours', () => {
  for (const [index, type] of types.entries()) {
    assert.equal(searchFilterColour(operators[index]), `bg-search-filter-${type} border-search-filter-${type}`)
    assert.equal(config.theme.extend.backgroundColor[`search-filter-${type}`], `var(--bg-search-filter-${type})`)
    assert.equal(config.theme.extend.borderColor[`search-filter-${type}`], `var(--border-search-filter-${type})`)
  }
  assert.equal(config.theme.extend.backgroundColor['search-highlight'], 'var(--bg-search-highlight)')
  const source = fs.readFileSync(path.join(root, 'src/app/search/SearchComp.tsx'), 'utf8')
  assert.match(source, /import "\.\/search-autocomplete\.css";/)
  assert.match(source, /autocompleteEnabled && 'search-autocomplete'/)
  assert.match(source, /className="rounded-\[2px\] bg-search-highlight text-inherit"/)
})
