const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture } = require('./helpers/htpr-7179-team.cjs');

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound', 'human']) {
    test(`${mode} ${actor}: stale task/comment indexes never cross writer, related-candidate or RAG model inputs`, async () => {
      const f = teamFixture(mode, actor);
      const rows = [f.tasks[0], f.tasks[3]].map((task) => ({
        id: String(task.id), projectId: 15, uniqueIndex: task.uniqueIndex,
        title: `${task.projectId === 15 ? 'A' : 'B'}-indexed-title`,
        descriptionText: `${task.projectId === 15 ? 'A' : 'B'}-indexed-description`,
        projectTitle: 'A-board', ticketNumber: task.ticketNumber, status: 'Normal', updatedAt: '2026-01-01',
      }));
      const comments = rows.map((row) => ({
        id: row.id, taskId: row.id, projectId: row.projectId, taskUniqueIndex: row.uniqueIndex,
        taskTitle: row.title, commentText: row.title.replace('title', 'comment'),
        taskTicketNumber: row.ticketNumber, taskProjectTitle: 'A-board', taskStatus: 'Normal', createdAt: '2026-01-01',
      }));
      const captured = [];
      const search = { searchTasks: async () => rows, searchComments: async () => comments, listCustomInstructionFileRows: async () => [], searchCustomInstructionFiles: async () => [] };
      Object.assign(f.mocks, {
        '@/utils/controllers/turbopuffer/turbopufferHelper': search,
        '@/lib/ai/htpr7038ModelReset': {},
        '@/app/api/ai/_lib/modelProvider': { configureAiModelUsage: () => {} },
        '@/app/api/ai/_lib/byokKeys': {},
        '@/app/api/ai/_lib/planGate': {},
        '@/app/api/ai/_lib/providerGate': { getProjectTeamProviderContext: async () => ({ settings: {} }) },
        '@/lib/systemModelLadder': { isAiFeatureEnabled: () => true },
        '@/app/api/ai/_lib/promptCache': { cachedInstructionsForUser: async (_user, input) => input.fixed + input.suffix },
        ai: { generateText: async (input) => { captured.push(JSON.stringify(input)); return { text: '<p>Allowed draft.</p>' }; }, wrapLanguageModel: () => ({}) },
      });
      const editor = f.load('src/app/api/ai/_lib/editorAi.ts');
      f.mocks['@/app/api/ai/_lib/editorAi'] = { ...editor, selectTaskWriterModel: async () => ({ model: {}, modelId: 'fixture', usageProvider: 'fixture', settings: {} }) };
      f.prisma.taskTemplate = f.model([], 'templates');
      const run = f.load('src/app/api/ai/_lib/taskWriterRun.ts');
      const draft = f.load('src/app/api/ai/_lib/taskWriterDraft.ts', { '@/app/api/ai/_lib/taskWriterRun': run });
      const rag = f.load('src/lib/rag/retrieveBoardKnowledge.ts');
      await f.run(new NextRequest('http://localhost/api/mcp/ai/task-writer'), async () => {
        const body = run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: 'Draft a ticket' });
        const result = await draft.generateTaskWriterDraft(body, f.user.id, f.state.ctx.agentId, undefined, f.state.ctx.teamScope);
        assert.equal(result.success, true);
        assert.equal(captured.length, 1);
        assert.match(captured[0], /A-indexed-title/);
        assert.match(captured[0], /A-indexed-comment/);
        assert.match(captured[0], /RELATED_TICKET_CANDIDATES/);
        assert.equal(captured[0].includes('B-indexed-'), actor !== 'bound');
        const documents = await rag.retrieveBoardKnowledge({ query: 'fixture', limit: 10 }, { userId: f.user.id, agentId: f.state.ctx.agentId, teamScope: f.state.ctx.teamScope });
        assert.equal(documents.success, true);
        assert.match(JSON.stringify(documents), /A-indexed-title/);
        assert.equal(JSON.stringify(documents).includes('B-indexed-'), actor !== 'bound');
        f.prisma.comment.findMany = async () => [];
        if (actor === 'bound') {
          const context = await editor.retrieveTaskWriterContext({ projectId: 15, prompt: 'fixture', principal: { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope } });
          assert.match(context, /A-indexed-title/);
          assert.doesNotMatch(context, /indexed-comment|B-indexed/);
        }
      });
    });
  }
}
