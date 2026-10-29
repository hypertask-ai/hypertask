const test = require('node:test');
const assert = require('node:assert/strict');
const { load, restore } = require('./board-filters/runtime.cjs');
const { getFilteredEmptySections } = load('utils/helperFunctions/Views/EmptySectionsHelperFunction.ts');
const { getActiveEmptySectionSettingFromProject } = load('utils/helperFunctions/Views/ViewsHelperFunctions.ts');
const flag = load('lib/flags/definitions/htpr-7807-empty-view-columns.ts');

function emptyView(setting = 'Hidden') {
  const project = restore({ board_empty_sections: setting });
  const sections = project.sections.map((section) => ({ ...section, items: [] }));
  return { project, sections };
}

const ids = (sections) => sections.map((section) => section.id);

test('empty Hidden view shows its existing visible columns without editing the saved view', () => {
  const { project, sections } = emptyView();
  const before = JSON.stringify(project);
  assert.deepEqual(ids(getFilteredEmptySections(sections, project, true)), [1, 2, 3, 4, 5, 6]);
  assert.equal(JSON.stringify(project), before);
  assert.equal(getActiveEmptySectionSettingFromProject(project), 'Hidden');
});

test('first task restores normal hiding, last removal restores empty columns', () => {
  const { project, sections } = emptyView();
  sections[1].items = [{ id: 100, title: 'First task' }];
  assert.deepEqual(ids(getFilteredEmptySections(sections, project, true)), [2]);
  sections[1].items = [];
  assert.deepEqual(ids(getFilteredEmptySections(sections, project, true)), [1, 2, 3, 4, 5, 6]);
  assert.equal(getActiveEmptySectionSettingFromProject(project), 'Hidden');
});

test('explicitly hidden columns stay hidden, including populated hidden columns', () => {
  const { project, sections } = emptyView();
  sections[1].visibility = false;
  sections[1].items = [{ id: 101 }];
  assert.deepEqual(ids(getFilteredEmptySections(sections, project, true)), [1, 3, 4, 5, 6]);
  for (const section of sections) section.visibility = false;
  assert.deepEqual(getFilteredEmptySections(sections, project, true), []);
});

test('flag off preserves the prior empty-state path', () => {
  const { project, sections } = emptyView();
  assert.deepEqual(getFilteredEmptySections(sections, project, false), []);
  assert.deepEqual(getFilteredEmptySections(sections, project), []);
});

test('Show and other view preferences remain unchanged across reloads', () => {
  const { project, sections } = emptyView();
  const shown = emptyView('Show');
  const restoredProject = JSON.parse(JSON.stringify(project));
  assert.deepEqual(ids(getFilteredEmptySections(sections, restoredProject, true)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(getFilteredEmptySections(shown.sections, shown.project, true)), [1, 2, 3, 4, 5, 6]);
  assert.equal(getActiveEmptySectionSettingFromProject(shown.project), 'Show');
  assert.equal(getActiveEmptySectionSettingFromProject(project), 'Hidden');
});

test('no columns and builtin views with no matching sections stay empty', () => {
  const { project } = emptyView();
  assert.deepEqual(getFilteredEmptySections([], project, true), []);
});

test('the improvement defaults to Everyone and stays independently reversible', () => {
  const definition = flag.default ?? flag;
  assert.equal(definition.key, 'htpr-7807-empty-view-columns');
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
});
