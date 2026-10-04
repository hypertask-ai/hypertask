const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

test('the regression wrapper requests TAP even when the child defaults to the spec reporter', () => {
  fs.mkdirSync(path.join(root, '.unlazy/htpr-6478'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, '.unlazy/htpr-6478/reporter-'))
  const fixture = path.join(directory, 'fixture.test.cjs')
  fs.writeFileSync(fixture, "require('node:test')('reporter fixture', () => {})\n")
  const callbacks = []
  const results = []
  try {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'htpr-6478-regressions.test.cjs'), 'utf8'), {
      __dirname,
      process,
      console: { log() {} },
      require(id) {
        if (id === 'node:test') return (_name, callback) => callbacks.push(callback)
        if (id === 'node:child_process') return {
          spawnSync(command, args, options) {
            if (!args.includes('--test')) return spawnSync(command, args, options)
            const result = spawnSync(command, [...args.filter((arg) => !arg.endsWith('.test.cjs')), fixture], options)
            results.push(result)
            return result
          },
        }
        if (id === 'node:fs') return { ...fs, writeFileSync() {} }
        return require(id)
      },
    })
    assert.equal(callbacks.length, 1)
    callbacks[0]()
    assert.equal(results.length, 1)
    assert.equal(results[0].status, 0)
    assert.match(results[0].stdout, /^# tests 1$/m)
    assert.match(results[0].stdout, /^# fail 0$/m)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
