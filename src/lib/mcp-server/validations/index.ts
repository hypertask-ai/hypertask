/**
 * Validation schemas index
 * 
 * Central re-export point for all validation schemas.
 * Provides backward compatibility with old import paths.
 * 
 * @example
 * // Old way (still works)
 * import { getAddCommentInputSchema } from '../utils/validation';
 * 
 * // New way (preferred)
 * import { getAddCommentInputSchema } from '../validations/comment.validation';
 */

// Agent validations
export {
  getListAgentsInputSchema,
  ListAgentsInputSchema,
  type ListAgentsInput,
} from './agent.validation';

// Task validations
export {
  getGetTasksInputSchema,
  getGetTasksBaseSchema,
  getListTasksInputSchema,
  getSearchTasksInputSchema,
  getEnhancedSearchTasksInputSchema,
  getUpdateTaskInputSchema,
  getUpdateTaskBaseSchema,
  getAssignUserBaseSchema,
  getAssignUserInputSchema,
  GetTaskInputSchema,
  ListTasksInputSchema,
  SearchTasksInputSchema,
  EnhancedSearchTasksInputSchema,
  UpdateTaskInputSchema,
  AssignUserInputSchema,
  type GetTaskInput,
  type ListTasksInput,
  type SearchTasksInput,
  type EnhancedSearchTasksInput,
  type UpdateTaskInput,
  type AssignUserInput,
} from './task.validation';

// Comment validations
export {
  getAddCommentInputSchema,
  getAddCommentBaseSchema,
  getAddCommentCrudBaseSchema,
  getAddCommentCrudInputSchema,
  getGetCommentsInputSchema,
  getGetCommentsBaseSchema,
  sanitizeCommentText,
  validateAndSanitizeAddCommentInput,
  validateAndSanitizeAddCommentCrudInput,
  AddCommentInputSchema,
  AddCommentCrudInputSchema,
  GetCommentsInputSchema,
  mentionSchema,
  type AddCommentInput,
  type AddCommentCrudInput,
  type GetCommentsInput,
  type MentionInput,
} from './comment.validation';

// Skill validations
export {
  getListSkillsBaseSchema,
  getGetSkillBaseSchema,
  getCreateSkillBaseSchema,
  getCreateSkillInputSchema,
  getUpdateSkillBaseSchema,
  getUpdateSkillInputSchema,
  getDeleteSkillBaseSchema,
  getImportSkillsBaseSchema,
  getImportSkillsInputSchema,
  validateAndSanitizeListSkillsInput,
  validateAndSanitizeGetSkillInput,
  validateAndSanitizeCreateSkillInput,
  validateAndSanitizeUpdateSkillInput,
  validateAndSanitizeDeleteSkillInput,
  validateAndSanitizeImportSkillsInput,
  ListSkillsInputSchema,
  GetSkillInputSchema,
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
  DeleteSkillInputSchema,
  ImportSkillsInputSchema,
  skillScopeSchema,
  type ListSkillsInput,
  type GetSkillInput,
  type CreateSkillInput,
  type UpdateSkillInput,
  type DeleteSkillInput,
  type ImportSkillsInput,
} from './skill.validation';

// Project validations
export {
  getListProjectsInputSchema,
  getListSectionsInputSchema,
  getListSectionsBaseSchema,
  ListProjectsInputSchema,
  ListSectionsInputSchema,
  ListProjectMembersInputSchema,
  type ListProjectsInput,
  type ListSectionsInput,
  type ListProjectMembersInput,
} from './project.validation';

// Inbox validations
export {
  getInboxListInputSchema,
  getInboxArchiveInputSchema,
  getInboxUnarchiveInputSchema,
  InboxListInputSchema,
  InboxArchiveInputSchema,
  InboxUnarchiveInputSchema,
  type InboxListInput,
  type InboxArchiveInput,
  type InboxUnarchiveInput,
} from './inbox.validation';

// Common schemas (exported for advanced use cases)
export {
  ticketNumberSchema,
  createTaskIdentificationSchema,
  createTaskIdentificationBaseSchema,
  createTaskIdentificationArraySchema,
} from './common/task-identification';

export {
  paginationSchema,
  createSearchPaginationSchema,
  sortOrderSchema,
  sortBySchema,
} from './common/pagination';

// Report validations
export {
  getReportCrudBaseSchema,
  getReportCrudInputSchema,
  ReportCrudInputSchema,
  type ReportCrudInput,
} from './report.validation';

export {
  priorityFilterSchema,
  priorityFilterNoNoneSchema,
  priorityIndexSchema,
  statusFilterSchema,
  assignedToFilterSchema,
  assignedToSearchFilterSchema,
  labelsFilterSchema,
  labelsAssignSchema,
} from './common/filters';
