import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checklistFromBrief } from './design-lib.mjs';
const [action, file] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file,'utf8'));
if (action === 'checklist') console.log(checklistFromBrief(data.tasks[0].description || ''));
