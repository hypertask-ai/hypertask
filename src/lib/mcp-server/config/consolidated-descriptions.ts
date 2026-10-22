import { DECISIONS_GUIDANCE } from '@/lib/mcp/decisionsGuidance'
import feedback from './descriptions/report_feedback.json'
import user_context from './descriptions/user_context.json'
import tasks from './descriptions/tasks.json'
import comments from './descriptions/comments.json'
import projects from './descriptions/projects.json'
import sections from './descriptions/sections.json'
import labels from './descriptions/labels.json'
import custom_fields from './descriptions/custom_fields.json'
import inbox from './descriptions/inbox.json'
import pages from './descriptions/pages.json'
import agents from './descriptions/agents.json'
import tokens from './descriptions/tokens.json'
import webhooks from './descriptions/webhooks.json'
import time from './descriptions/time.json'
import views from './descriptions/views.json'
import skills from './descriptions/skills.json'
import search from './descriptions/search.json'
import reports from './descriptions/reports.json'
import decisions from './descriptions/decisions.json'
import drafts from './descriptions/drafts.json'
import attachments from './descriptions/attachments.json'

export const CONSOLIDATED_TOOL_DESCRIPTIONS = [
  feedback,
  user_context,
  tasks,
  { ...comments, use_when: `${comments.use_when} ${DECISIONS_GUIDANCE}` },
  projects,
  sections,
  labels,
  custom_fields,
  inbox,
  pages,
  agents,
  tokens,
  webhooks,
  time,
  views,
  skills,
  search,
  reports,
  { ...decisions, do_not_use_when: `${decisions.do_not_use_when} ${DECISIONS_GUIDANCE}` },
  drafts,
  attachments,
]
