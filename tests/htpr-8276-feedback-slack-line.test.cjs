const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '../src') }, cache: false })
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

const posts = []
const labelIds = []
let installRow = null
stub('src/lib/crypto/byokCipher.ts', { decryptSecret: (value) => `plain:${value}` })
stub('src/lib/slack/api.ts', {
  postSlackMessage: async (...args) => {
    posts.push(args)
    if (posts.length === 2) throw new Error('channel_not_found')
  },
})
stub('src/lib/prisma.ts', {
  default: {
    label: {
      findFirst: async ({ where }) => {
        labelIds.push(where.id.in)
        assert.equal(where.projectId, 15)
        assert.equal(where.value, 'ai-feedback')
        return where.id.in.includes('label-ai') ? { id: 'label-ai' } : null
      },
    },
    slackInstall: { findFirst: async () => installRow },
  },
})

const { announceFeedbackTicket, feedbackLine, feedbackTicketUrl } = jiti('../src/lib/aiFeedback/slackLine.ts')

const feedbackTicket = {
  projectId: 15,
  labelIds: ['label-ai'],
  uniqueIndex: 8487,
  title: 'Agent feedback, bug: An agent list call returns nothing',
}
const slackReady = () => {
  posts.length = 0
  labelIds.length = 0
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
  assert.equal(feedbackLine('Agent feedback, idea: ', 'https://app.hypertask.ai/detail/project-15/4'), '*idea* · Agent feedback, idea:  · https://app.hypertask.ai/detail/project-15/4')
  assert.equal(feedbackLine('Agent feedback, bug: <!channel> & <https://evil.test|click>', 'https://app.hypertask.ai/detail/project-15/5'), '*bug* · &lt;!channel&gt; &amp; &lt;https://evil.test|click&gt; · https://app.hypertask.ai/detail/project-15/5')
})

test('a new feedback ticket on board 15 posts exactly one line with the workspace bot', async () => {
  slackReady()
  await announceFeedbackTicket(feedbackTicket)
  assert.equal(posts.length, 1)
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
