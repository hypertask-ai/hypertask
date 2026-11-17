const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
function setup(labels) {
  const created=[];
  const db={$executeRaw:async()=>{},$transaction:async run=>run(db),label:{findMany:async()=>labels,create:async({data})=>{created.push(data);return {id:'created-medium'};}}};
  return {created,...load('src/lib/agents/defaultBrainLabel.ts',{'@/lib/prisma':{default:db}})};
}
test('absent brain defaults to existing medium and retains other labels',async()=>{
  const h=setup([{id:'bug',value:'Bug'},{id:'medium',value:'brain-medium'}]);
  assert.deepEqual(await h.defaultAgentBrainLabelIds(7,['bug']),['bug','medium']);
  assert.equal(h.created.length,0);
});
test('a board without medium gets that default',async()=>{
  const h=setup([]);
  assert.deepEqual(await h.defaultAgentBrainLabelIds(7,[]),['created-medium']);
  assert.deepEqual(h.created,[{projectId:7,value:'brain-medium'}]);
});
test('explicit brain choice is preserved',async()=>{
  const h=setup([{id:'hard',value:'brain-hard'}]);
  assert.deepEqual(await h.defaultAgentBrainLabelIds(7,['bug','hard']),['bug','hard']);
  assert.equal(h.created.length,0);
});
