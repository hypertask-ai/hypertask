const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const posts = []
let installRow = null
let flagOn = true
const flagChecks = []
const modules = () => loadModule('src/lib/aiFeedback/slackLine.ts', {
  '@/lib/crypto/byokCipher': { decryptSecret: (value) => `plain:${value}` },
  '@/lib/flags': { isFeatureEnabled: async (key, userId) => (flagChecks.push([key, userId]), flagOn) },
  '@/lib/slack/api': {
    postSlackMessage: async (...args) => {
      posts.push(args)
      if (posts.length === 2) throw new Error('channel_not_found')
    },
  },
  '@/lib/prisma': {
    default: {
      label: {
        findFirst: async ({ where }) => {
          assert.equal(where.projectId, 15)
          assert.equal(where.value, 'ai-feedback')
          return where.id.in.includes('label-ai') ? { id: 'label-ai' } : null
        },
      },
      slackInstall: { findFirst: async ({ orderBy }) => (assert.deepEqual(orderBy, { updatedAt: 'desc' }), installRow) },
    },
  },
})

const { announceFeedbackTicket, feedbackLine, feedbackTicketUrl } = modules()

const feedbackTicket = {
  projectId: 15,
  labelIds: ['label-ai'],
  uniqueIndex: 8487,
  title: 'Agent feedback, bug: An agent list call returns nothing',
  userId: 404,
}
const slackReady = () => {
  posts.length = 0
  flagChecks.length = 0
  flagOn = true
  process.env.SLACK_FEEDBACK_CHANNEL_ID = 'C-FEEDBACK'
  installRow = { encryptedBotToken: 'cipher' }
}

test('the line names the kind, the short summary and the ticket link and carries nothing else', () => {
  assert.equal(
    feedbackLine('Agent feedback, bug: An agent list call returns nothing', feedbackTicketUrl(8487)),
    '*bug* · An agent list call returns nothing · https://app.hypertask.ai/detail/project-15/8487',
  )
  assert.equal(feedbackLine('Agent feedback, friction: Two lists disagree', 'https://app.hypertask.ai/detail/project-15/2'), '*friction* · Two lists disagree · https://app.hypertask.ai/detail/project-15/2')
  assert.equal(feedbackLine("An agent's CLI call to list had a problem (3 Nov)", 'https://app.hypertask.ai/detail/project-15/3'), "*feedback* · An agent's CLI call to list had a problem (3 Nov) · https://app.hypertask.ai/detail/project-15/3")
  assert.equal(feedbackLine('Agent feedback, idea: ', 'https://app.hypertask.ai/detail/project-15/4'), '*idea* · Agent feedback, idea: · https://app.hypertask.ai/detail/project-15/4')
})

test('a Slack line cannot ping the channel or disguise a link', () => {
  assert.equal(
    feedbackLine('Agent feedback, bug: <!channel> & <https://evil.test|click>', 'https://app.hypertask.ai/detail/project-15/5'),
    '*bug* · &lt;!channel&gt; &amp; &lt;https://evil.test|click&gt; · https://app.hypertask.ai/detail/project-15/5',
  )
})

test('a new feedback ticket on board 15 posts exactly one line with the workspace bot', async () => {
  slackReady()
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 1)
  assert.deepEqual(flagChecks, [['htpr-8276-feedback-slack-line', 404]])
  const [botToken, channelId, blocks] = posts[0]
  assert.equal(botToken, 'plain:cipher')
  assert.equal(channelId, 'C-FEEDBACK')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text.text, '*bug* · An agent list call returns nothing · https://app.hypertask.ai/detail/project-15/8487')
})

test('tickets outside board 15, without the feedback label, or without a channel post nothing', async () => {
  slackReady()
  await announceFeedbackTicket({ ...feedbackTicket, projectId: 4060 })
  assert.equal(posts.length, 0)

  slackReady()
  await announceFeedbackTicket({ ...feedbackTicket, labelIds: ['label-other'] })
  assert.equal(posts.length, 0)

  slackReady()
  await announceFeedbackTicket({ ...feedbackTicket, labelIds: undefined })
  assert.equal(posts.length, 0)

  slackReady()
  delete process.env.SLACK_FEEDBACK_CHANNEL_ID
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 0)

  slackReady()
  process.env.SLACK_FEEDBACK_CHANNEL_ID = '   '
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 0)
})

test('Flag Off stops the line even when a channel is named', async () => {
  slackReady()
  flagOn = false
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 0)
  assert.deepEqual(flagChecks, [['htpr-8276-feedback-slack-line', 404]])
})

test('a workspace without a Slack install posts nothing', async () => {
  slackReady()
  installRow = null
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 0)
})

test('a refused Slack post surfaces so the task-create caller can swallow it', async () => {
  slackReady()
  await announceFeedbackTicket(feedbackTicket)
  await assert.rejects(() => announceFeedbackTicket({ ...feedbackTicket, uniqueIndex: 8488 }), /channel_not_found/)
  assert.equal(posts.length, 2)
})
