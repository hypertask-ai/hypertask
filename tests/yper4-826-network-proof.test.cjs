const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

test('proof HAR preserves status and time but never authentication, queries or bodies', async () => {
  let fixture;
  const source = await fs.readFile(path.join(__dirname, '../e2e/smoke/proof-network.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === '@playwright/test' ? { test: { extend(options) { fixture = options.proofNetwork[0]; return {}; } } } : require(name), loaded, loaded.exports);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yper4-826-network-'));
  const oldDir = process.env.PROOF_NETWORK_DIR;
  const oldCase = process.env.PROOF_CASE;
  const oldLog = console.log;
  const messages = [];
  process.env.PROOF_NETWORK_DIR = dir;
  process.env.PROOF_CASE = 'privacy-test';
  console.log = text => messages.push(text);
  try {
    const context = new EventEmitter();
    const request = {
      url: () => 'http://127.0.0.1:3100/api/activity/addLastActiveAt?token=private-query#private-fragment',
      method: () => 'POST', resourceType: () => 'fetch', timing: () => ({startTime: Date.now()-10, requestStart: 1, responseStart: 8}),
      failure: () => ({errorText:'net::ERR_ABORTED private-query'}),
      headers: () => { throw Error('Headers must never be read'); },
      postData: () => { throw Error('Bodies must never be read'); },
    };
    await fixture({context}, async () => {
      context.emit('response', {request:()=>request,status:()=>200,statusText:()=> 'OK'});
      context.emit('response', {request:()=>request,status:()=>500,statusText:()=> 'Internal Server Error'});
      context.emit('requestfailed', request);
    }, {titlePath:['privacy'],project:{name:'Desktop'},retry:0,status:'passed',expectedStatus:'passed',file:'proof.spec.ts',title:'privacy'});
    const files = await fs.readdir(dir);
    assert.equal(files.length,1);
    const raw = await fs.readFile(path.join(dir,files[0]),'utf8');
    assert(!raw.includes('private-query')); assert(!raw.includes('private-fragment'));
    const har = JSON.parse(raw);
    assert.equal(har.log.version,'1.2');
    assert.deepEqual(har.log.entries.map(entry=>entry.response.status),[200,500,0]);
    for(const entry of har.log.entries){
      assert.equal(new URL(entry.request.url).search,'');
      assert.deepEqual(entry.request.headers,[]); assert.deepEqual(entry.request.cookies,[]); assert.deepEqual(entry.request.queryString,[]);
      assert.deepEqual(entry.response.headers,[]); assert.deepEqual(entry.response.cookies,[]);
      assert(!Object.hasOwn(entry.request,'postData')); assert(!Object.hasOwn(entry.response.content,'text'));
      assert(Number.isFinite(Date.parse(entry.startedDateTime))); assert(Number.isFinite(Date.parse(entry._observedAt)));
    }
    assert.equal(messages.length,2);
    assert(messages.every(message=>!message.includes('private-query')));
    assert.equal(context.listenerCount('response'),0); assert.equal(context.listenerCount('requestfailed'),0);
  } finally {
    console.log=oldLog;
    if(oldDir===undefined)delete process.env.PROOF_NETWORK_DIR;else process.env.PROOF_NETWORK_DIR=oldDir;
    if(oldCase===undefined)delete process.env.PROOF_CASE;else process.env.PROOF_CASE=oldCase;
    await fs.rm(dir,{recursive:true,force:true});
  }
});
