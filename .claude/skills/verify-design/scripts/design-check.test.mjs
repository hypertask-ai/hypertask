import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { checklistFromBrief, isPurple, isRoundMarker, radiusVerdict } from './design-lib.mjs';
test('brief scope and fallback', () => {
  const x = checklistFromBrief('<h2>Change</h2><p>Show cards. Hide clutter.</p><h2>Not in scope</h2><p>Other work.</p>');
  assert.match(x, /^1\. \[ \] Show cards\.\n2\. \[ \] Hide clutter\./); assert.doesNotMatch(x, /Other work/);
  const real = checklistFromBrief('<p>Change table</p><p>Keep. Existing layout.</p><p><strong>Change.</strong></p><p>Fix cards.</p><p>Not in scope.</p>');
  assert.match(real, /^1\. \[ \] Fix cards\./); assert.doesNotMatch(real, /Keep|table/);
  assert.match(checklistFromBrief('<p>One. Two!</p>'), /^1\. \[ \] One\.\n2\. \[ \] Two!/);
});
test('purple colours', () => {
  for (const x of ['#7c3aed','rgb(124,58,237)']) assert.equal(isPurple(x), true, x);
  for (const x of ['#6b7280','transparent','#3b82f6']) assert.equal(isPurple(x), false, x);
});
test('radius', () => {
  for (const [r,w,h,v] of [[4,100,100,'ok'],[6,100,100,'bad'],[12,24,24,'round'],[9999,20,20,'round'],[8,200,40,'bad'],[20,120,40,'bad']]) assert.equal(radiusVerdict(r,r,w,h),v);
  assert.equal(radiusVerdict(16,16,32,32,false),'bad');
  assert.equal(radiusVerdict(2,8,100,100),'bad');
  assert.equal(radiusVerdict(3,4,100,100),'bad');
  assert.equal(radiusVerdict(4,2,100,100),'ok');
  assert.equal(radiusVerdict(4,16,32,32),'bad');
  for (const [names,v] of [['avatar',true],['user-avatar rounded-full',true],['status-dot',true],['avatar_img',true],['border-dotted',false],['dot',false],['rounded-full h-8 w-8',false],['',false],['avatars-list-dotted',false]]) assert.equal(isRoundMarker(names),v,names);
});
