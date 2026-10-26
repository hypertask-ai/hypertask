const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./task-route-loader.cjs');

const flagKey = 'htpr-7978-ai-chip-events';
const { createAiChipRecorder } = load('src/lib/ai/chipEvents.ts', {});
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function recorder() {
  const events = [];
  return { events, recorder: createAiChipRecorder(payload => events.push(payload)) };
}

const shown = (chips = ['A', 'B', 'C'], extra = {}) => ({ kind: 'shown', surface: 'welcome-board', chipType: 'suggested', chips, projectId: 9, ...extra });

test('showing chips logs one shown event with board and chip type', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle(shown());
  assert.deepEqual(events.map(e => e.event), ['shown']);
  assert.equal(events[0].projectId, 9);
  assert.equal(events[0].chipType, 'suggested');
  assert.deepEqual(events[0].chips, ['A', 'B', 'C']);
});

test('a clicked chip logs the click and never logs ignored or typed text', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'clicked', text: 'B', index: 1 });
  r.handle({ kind: 'send', text: 'B' });
  r.leave();
  assert.deepEqual(events.map(e => e.event), ['shown', 'clicked']);
  assert.equal(events[1].chipIndex, 1);
  assert.equal(events[1].chipText, 'B');
});

test('typing instead of clicking logs ignored and what was typed', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'send', text: 'something else entirely' });
  assert.deepEqual(events.map(e => e.event), ['shown', 'ignored', 'next_typed']);
  assert.equal(events[2].typedText, 'something else entirely');
  assert.equal(events[2].typedLength, 'something else entirely'.length);
  assert.deepEqual(events[1].chips, ['A', 'B', 'C']);
});

test('typed text is cut to 200 characters but its full length is kept', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'send', text: 'x'.repeat(500) });
  assert.equal(events[2].typedText.length, 200);
  assert.equal(events[2].typedLength, 500);
});

test('chips replaced or left without a choice log ignored once', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle(shown(['D', 'E']));
  r.leave();
  r.leave();
  assert.deepEqual(events.map(e => e.event), ['shown', 'ignored', 'shown', 'ignored']);
  assert.deepEqual(events[1].chips, ['A', 'B', 'C']);
});

test('a send with no chips on screen logs nothing', () => {
  const { events, recorder: r } = recorder();
  r.handle({ kind: 'send', text: 'hello' });
  assert.deepEqual(events, []);
});

test('a second message after a typed one is not logged again', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'send', text: 'first' });
  r.handle({ kind: 'send', text: 'second' });
  assert.equal(events.filter(e => e.event === 'next_typed').length, 1);
});

function route({ enabled = true, viewer = { id: 42 }, task = { id: 5, projectId: 9 }, project = { id: 9 } } = {}) {
  const recorded = [];
  const queries = [];
  const mocks = {
    next: {},
    'next/server': {
      NextRequest: class {},
      NextResponse: class NextResponse {
        constructor(body, init) { this.body = body; this.status = init?.status ?? 200; }
        static json(body, init) { return new NextResponse(JSON.stringify(body), init); }
      },
    },
    '@/app/api/ai/_lib/editorAi': { getCurrentUserFromCookies: async () => viewer },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ agentId: undefined }) },
    '@/lib/flags': { HTPR_7978_AI_CHIP_EVENTS_FLAG: flagKey, isFeatureEnabled: async (key, userId) => key === flagKey && userId === 42 && enabled },
    '@/lib/prisma': { default: {
      task: { findFirst: async args => { queries.push(['task', args]); return task; } },
      project: { findFirst: async args => { queries.push(['project', args]); return project; } },
    } },
    '@/lib/telemetry/aiChatObservability': { recordAiChipEvent: async chip => { recorded.push(chip); } },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({ scoped: true }) },
  };
  return { recorded, queries, POST: load('src/app/api/ai/chip-events/route.ts', mocks).POST };
}

const request = body => ({ headers: new Headers(), json: async () => body });
const base = { event: 'clicked', surface: 'welcome-board', chipType: 'suggested', chips: ['A'], chipIndex: 0, chipText: 'A' };

test('flag off logs nothing and answers 204', async () => {
  const h = route({ enabled: false });
  const res = await h.POST(request({ ...base, projectId: 9 }));
  assert.equal(res.status, 204);
  assert.deepEqual(h.recorded, []);
});

test('signed-out callers are refused', async () => {
  const h = route({ viewer: null });
  assert.equal((await h.POST(request(base))).status, 401);
  assert.deepEqual(h.recorded, []);
});

test('bad shapes are refused and nothing is logged', async () => {
  const h = route();
  for (const body of [{}, { ...base, event: 'nope' }, { ...base, chips: Array(13).fill('x') }, { ...base, chipText: 'x'.repeat(201) }, null]) {
    assert.equal((await h.POST(request(body))).status, 400);
  }
  assert.deepEqual(h.recorded, []);
});

test('the board comes from an access checked ticket, never from the client alone', async () => {
  const h = route();
  const res = await h.POST(request({ ...base, taskId: 5, projectId: 1234 }));
  assert.equal(res.status, 204);
  assert.equal(h.recorded[0].projectId, 9);
  assert.equal(h.recorded[0].taskId, 5);
  assert.equal(h.recorded[0].userId, 42);
  assert.equal(h.queries[0][0], 'task');
  assert.equal(h.queries[0][1].where.project.scoped, true);
});

test('a board the viewer cannot read is dropped from the event', async () => {
  const h = route({ project: null });
  await h.POST(request({ ...base, projectId: 77 }));
  assert.equal(h.recorded[0].projectId, null);
});

test('a still allowed event for a readable board is recorded with its chip type', async () => {
  const h = route();
  await h.POST(request({ ...base, projectId: 9 }));
  assert.equal(h.recorded[0].projectId, 9);
  assert.equal(h.recorded[0].chipType, 'suggested');
  assert.equal(h.recorded[0].event, 'clicked');
});

test('the capture carries board, chip type and chip text on every event name', () => {
  const { buildAiChipCapture } = load('src/lib/telemetry/aiChatObservability.ts', { 'posthog-node': { PostHog: class {} }, '@/lib/telemetry/errorSanitization': { redactErrorText: text => text } });
  const capture = buildAiChipCapture({ userId: 42, event: 'next_typed', surface: 'welcome-board', chipType: 'suggested', chips: ['A'], typedText: 'hi', typedLength: 2, projectId: 9, taskId: null }, 'production');
  assert.equal(capture.event, 'ai_chat_chip_next_typed');
  assert.equal(capture.distinctId, '42');
  assert.equal(capture.properties.ht_project_id, 9);
  assert.equal(capture.properties.ht_chip_type, 'suggested');
  assert.equal(capture.properties.ht_typed_text, 'hi');
});

test('chip buttons keep their text, order and send behaviour', () => {
  const welcome = read('src/components/AI_CHAT/WelcomeScreen.tsx');
  assert.match(welcome, /clickChip\(suggestion, index, shownType\)/);
  assert.match(welcome, /clickChip\(example, index, "board-example"\)/);
  assert.match(welcome, /handleSendMessage\(sent\)/);
  const send = read('src/hooks/MultiPages/AIChat/aiChatSend.ts');
  assert.match(send, /signalAiChip\(\{ kind: "send", text: content \}\)/);
});

test('a dismissed chat logs ignored once and a later send from another chat logs nothing', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'dismiss', surface: 'welcome-board' });
  r.handle({ kind: 'send', text: 'from another chat' });
  assert.deepEqual(events.map(e => e.event), ['shown', 'ignored']);
});

test('dismissing another surface keeps the pending chips', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle({ kind: 'dismiss', surface: 'new-ticket-questions' });
  r.handle({ kind: 'send', text: 'typed' });
  assert.deepEqual(events.map(e => e.event), ['shown', 'ignored', 'next_typed']);
});

test('the same chips on another board or after a dismissal are a new exposure', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown());
  r.handle(shown(['A', 'B', 'C'], { projectId: 10 }));
  r.handle({ kind: 'dismiss', surface: 'welcome-board' });
  r.handle(shown(['A', 'B', 'C'], { projectId: 10 }));
  assert.deepEqual(events.map(e => e.event), ['shown', 'ignored', 'shown', 'ignored', 'shown']);
  assert.equal(events[2].projectId, 10);
});

test('summary and ask all controls log their own shown events', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown(['A'], { controls: [{ chipType: 'summary-action', label: 'Summarize' }, { chipType: 'ask-all', label: 'Ask all' }] }));
  assert.deepEqual(events.map(e => e.chipType), ['suggested', 'summary-action', 'ask-all']);
  assert.deepEqual(events[1].chips, ['Summarize']);
});

test('hidden or inactive ticket questions never signal shown', () => {
  const list = read('src/components/AI_CHAT/MessageList.tsx');
  assert.match(list, /if \(!chipEventsEnabled \|\| !active \|\| hidden \|\| !showTicketQuestions/);
  assert.match(list, /kind: "dismiss", surface: "new-ticket-questions"/);
});

test('every UI entry reads the chip events flag and the recorder is not a new component file', () => {
  for (const file of ['src/components/AI_CHAT/WelcomeScreen.tsx', 'src/components/AI_CHAT/MessageList.tsx', 'src/hooks/MultiPages/AIChat/useAiChat.ts']) {
    assert.match(read(file), /useFlag\(HTPR_7978_AI_CHIP_EVENTS_FLAG\)/, file);
  }
  assert.match(read('src/app/layout.tsx'), /isFeatureEnabled\(HTPR_7978_AI_CHIP_EVENTS_FLAG/);
  assert.match(read('src/hooks/MultiPages/AIChat/aiChatSend.ts'), /if \(chipEventsEnabled\) signalAiChip\(/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/components/AI_CHAT/AiChipEventRecorder.tsx')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/lib/ai/AiChipEventRecorder.tsx')), true);
});

test('summary and ask all log ignored when the chat is left without a choice', () => {
  const { events, recorder: r } = recorder();
  r.handle(shown(['A'], { controls: [{ chipType: 'summary-action', label: 'Summarize' }] }));
  r.leave();
  assert.deepEqual(events.map(e => [e.event, e.chipType]), [['shown', 'suggested'], ['shown', 'summary-action'], ['ignored', 'suggested'], ['ignored', 'summary-action']]);
});

test('the layout reads the guest status before it checks the chip events flag', () => {
  const layout = read('src/app/layout.tsx');
  assert.ok(layout.indexOf('const analyticsIsGuest') < layout.indexOf('const chipEventsEnabled'));
});
