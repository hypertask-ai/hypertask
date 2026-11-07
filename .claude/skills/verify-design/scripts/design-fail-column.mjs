import { failColumn } from './design-lib.mjs'

const name = failColumn(process.argv.slice(2))
if (!name) process.exit(1)
console.log(name)
