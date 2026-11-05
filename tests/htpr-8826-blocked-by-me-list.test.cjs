const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');
const { load, filters, board } = require('./board-filters/runtime.cjs');
const { fixture, sectionIds } = require('./board-filters/fixture.cjs');
const builtin = load('lib/constants/builtinViews.ts');
const subtasks = load('utils/helperFunctions/Views/SubtaskHelperFunction.ts');
const empty = load('utils/helperFunctions/Views/EmptySectionsHelperFunction.ts');
const flag = load('lib/flags/definitions/htpr-8826-blocked-by-me-list.ts');
const id = builtin.BUILTIN_VIEW_IDS.blockedByMe;
const context = { currentUserId: 6 };

function restrictedProject() {
  const { project } = fixture();
  const saved = {
    board_columns_view: project.section.map((section) => ({ ...section, visibility: section.id === 3 })),
    board_subtask_setting: 'None', board_empty_sections: 'Hidden',
  };
  project.project_view.default_view = saved;
  project.project_view.user_project_views = [{ appliedView: saved }];
  project.tasks[0].parentTask = { id: 'parent' };
  project.tasks[6].waitingOnUserId = 6;
  project.tasks[6].sectionId = 7;
  project.sections = board.getCurrentProject(project)._sections;
  return project;
}

function landing(project, enabled) {
  const state = { activeBuiltinViewsAtom: 'active' };
  const stubs = {
    react: { useMemo: (fn) => fn(), useState: (value) => [value, () => {}], useRef: () => ({ current: null }), useEffect: () => {}, useLayoutEffect: () => {}, useContext: () => false },
    '@/lib/state': { useRecoilValue: (atom) => atom === 'active' ? { [project.id]: id } : false, useSetRecoilState: () => () => {}, useRecoilState: () => [false, () => {}] },
    '@/store': state,
    '@/utils/helperFunctions/helperFunctions': { deepCopy: structuredClone },
    'next/navigation': { useRouter: () => ({}) },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/lib/contexts/mobileContext': {},
    '@/hooks/MultiPages/Route/useTrialModal': { __esModule: true, default: () => ({}) },
    '@/utils/helperFunctions/Views/FilterHelperFunctions': filters,
    '@/utils/helperFunctions/Views/SubtaskHelperFunction': subtasks,
    '@/utils/helperFunctions/Views/EmptySectionsHelperFunction': empty,
    '@/lib/constants/builtinViews': builtin,
    '@/hooks/Task Detail/useTimeTracking': { useBoardRunningTimers: () => ({ timers: new Map(), timerDataReady: true }) },
    '@/lib/contexts/boardStartupContext': { useBoardStartup: () => ({}) },
    '@/lib/lastBoardTeam': {},
    '@/hooks/useFlag': { useFlag: (key) => key === flag.HTPR_8826_BLOCKED_BY_ME_LIST_FLAG ? enabled : true },
        '@/lib/flags/definitions/htpr-7865-agent-creator-filter': {},
    '@/lib/flags/keys': flag,
  };
  const { useLandingSectionState } = loadModule('src/app/[...boardURL]/useLandingSectionState.ts', stubs);
  return useLandingSectionState({ _allProjects: [project], _projectIndex: 0, _currentUser: { id: 6 }, _boardLayout: 'board' }).filteredSectionsForActiveView;
}

test('Blocked by me count and landing rows agree after selecting a Done-only saved view', () => {
  const project = restrictedProject();
  const before = structuredClone(project);
  assert.deepEqual(sectionIds(landing(project, false)), []);
  const rows = landing(project, true);
  const counted = builtin.getBlockedByMeSections(project, context);
  assert.deepEqual(sectionIds(rows).sort(), ['a', 'g']);
  assert.deepEqual(sectionIds(rows).sort(), sectionIds(counted).sort());
  assert.ok(rows.every((section) => section.visibility));
  assert.deepEqual(project, before, 'saved views and blocker markers remain unchanged');
});

test('blocker changes remove a child row and its count together; another viewer stays isolated', () => {
  const project = restrictedProject();
  project.tasks[0].waitingOnUserId = null;
  assert.deepEqual(sectionIds(landing(project, true)), ['g']);
  assert.deepEqual(sectionIds(builtin.getBlockedByMeSections(project, context)), ['g']);
  assert.deepEqual(sectionIds(builtin.getBlockedByMeSections(project, { currentUserId: 7 })), ['b']);
  assert.deepEqual(sectionIds(builtin.getBlockedByMeSections(project, {})), []);
  project.tasks[6].waitingOnUserId = null;
  assert.deepEqual(sectionIds(landing(project, true)), []);
});

test('live update projection restores counted rows even after saved subtask filtering', () => {
  const project = restrictedProject();
  const restricted = subtasks.getAppliedSubtaskSections(project.sections, project);
  assert.deepEqual(sectionIds(filters.getFilteredSections(restricted, project, id, context)), []);
  assert.deepEqual(sectionIds(filters.getFilteredSections(restricted, project, id, context, { blockedByMeListEnabled: true })).sort(), ['a', 'g']);
  assert.deepEqual(
    filters.getFilteredSections(restricted, project, builtin.BUILTIN_VIEW_IDS.blocked, context, { blockedByMeListEnabled: true }),
    filters.getFilteredSections(restricted, project, builtin.BUILTIN_VIEW_IDS.blocked, context),
  );
});

test('restored rows ship only to Owner and QA', () => {
  assert.equal(flag.default.defaultMode, 'OWNER_AND_QA');
  assert.equal(flag.default.kind, 'bugfix');
});
