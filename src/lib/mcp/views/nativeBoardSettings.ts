import prisma from '@/lib/prisma';
import { sanitizeBoardFilters } from '@/utils/helperFunctions/Views/BoardFilterSanitizer';

const FILTER_TYPES = new Set([
  'Labels', 'Assignees', 'Priority', 'Size', 'DueDate', 'Status',
]);
const PRIORITIES = new Map<number, string>([
  [0, 'No Priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low'],
]);
const SIZES = new Map<number, string>([
  [0, 'No size'], [2, 'XS'], [3, 'S'], [4, 'M'], [5, 'L'], [6, 'XL'],
]);
const STATUSES = new Set(['Normal', 'Archive', 'Deleted']);
const DYNAMIC_DUE_RANGES = new Set([
  'ANY', 'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS',
  'THIS_WEEK', 'THIS_MONTH', 'OVERDUE', 'NEXT_7_DAYS', 'NO_DUE_DATE',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));

const isAbsent = (value: unknown) => value === null || value === undefined;

function validateDueDatePayload(item: Record<string, unknown>) {
  if (typeof item.dynamicRange === 'string') {
    const compatibleCondition = item.condition === null || item.condition === undefined ||
      (item.dynamicRange === 'ANY' && item.condition === 'ANY');
    const hasNoStaticDates = ['fromDate', 'toDate', 'selectedDate']
      .every((key) => item[key] === null || item[key] === undefined);
    return DYNAMIC_DUE_RANGES.has(item.dynamicRange) && compatibleCondition && hasNoStaticDates;
  }
  if (item.condition === 'ANY') {
    return ['fromDate', 'toDate', 'selectedDate'].every((key) => isAbsent(item[key]));
  }
  const hasRangeField = !isAbsent(item.fromDate) || !isAbsent(item.toDate);
  if (hasRangeField) {
    return isValidDate(item.fromDate) &&
      isValidDate(item.toDate) &&
      Date.parse(item.fromDate) <= Date.parse(item.toDate) &&
      isAbsent(item.selectedDate) &&
      isAbsent(item.condition);
  }
  if (isValidDate(item.selectedDate)) {
    return isAbsent(item.fromDate) &&
      isAbsent(item.toDate) &&
      (isAbsent(item.condition) || item.condition === 'BEFORE' || item.condition === 'AFTER');
  }
  return false;
}

function validateTypedPayload(type: string, item: Record<string, unknown>) {
  switch (type) {
    case 'Priority':
      return typeof item.priority_index === 'number' &&
        PRIORITIES.get(item.priority_index) === item.Priority_Value;
    case 'Size':
      return typeof item.estimate_index === 'number' &&
        SIZES.get(item.estimate_index) === item.estimate_value;
    case 'Status':
      return typeof item.value === 'string' && STATUSES.has(item.value);
    case 'DueDate':
      return validateDueDatePayload(item);
    default:
      return true;
  }
}

export function normalizeNativeBoardFilters(value: unknown) {
  if (!isRecord(value)) throw new Error('board_filters must be an object');
  if (value.matchFilters !== 'ALL' && value.matchFilters !== 'ANY') {
    throw new Error("board_filters.matchFilters must be 'ALL' or 'ANY'");
  }
  if (!Array.isArray(value.addedFilters) || value.addedFilters.length > 20) {
    throw new Error('board_filters.addedFilters must contain at most 20 filters');
  }
  const seenTypes = new Set<string>();
  for (const entry of value.addedFilters) {
    if (!isRecord(entry) || typeof entry.type !== 'string' || !FILTER_TYPES.has(entry.type)) {
      throw new Error('board_filters contains an unsupported filter type');
    }
    if (seenTypes.has(entry.type)) {
      throw new Error(`board_filters contains duplicate ${entry.type} filters`);
    }
    seenTypes.add(entry.type);
    if (!Array.isArray(entry.searchPayload) || entry.searchPayload.length > 100) {
      throw new Error('Each board filter must contain at most 100 values');
    }
    if (entry.type === 'Assignees' && entry.searchPayload.length === 0) {
      throw new Error('board_filters.Assignees must contain at least one assignee');
    }
    if (entry.type === 'DueDate' && entry.searchPayload.length !== 1) {
      throw new Error('board_filters.DueDate must contain exactly one value');
    }
    if (entry.searchPayload.some((item) => !isRecord(item))) {
      throw new Error(`board_filters.${entry.type} values must be objects`);
    }
    if (
      entry.type === 'Labels' &&
      entry.searchPayload.some((item) => {
        const id = (item as Record<string, unknown>).id;
        return typeof id !== 'string' || id.length === 0;
      })
    ) {
      throw new Error('board_filters.Labels values must contain label ids');
    }
    if (
      entry.type === 'Assignees' &&
      entry.searchPayload.some((item) => {
        const id = (item as Record<string, unknown>).id;
        return !(typeof id === 'string' && id.length > 0) &&
          !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
      })
    ) {
      throw new Error('board_filters.Assignees values must contain member or agent ids');
    }
    if (
      entry.searchPayload.some((item) =>
        !validateTypedPayload(entry.type as string, item as Record<string, unknown>))
    ) {
      throw new Error(`board_filters.${entry.type} contains an invalid value`);
    }
    if (entry.match !== undefined && entry.match !== 'ALL' && entry.match !== 'ANY') {
      throw new Error("Each board filter match must be 'ALL' or 'ANY'");
    }
    if (
      entry.match === 'ALL' &&
      entry.type !== 'Labels' &&
      entry.type !== 'Assignees'
    ) {
      throw new Error(`board_filters.${entry.type} only supports match 'ANY'`);
    }
  }
  const sanitized = sanitizeBoardFilters(value);
  if (JSON.stringify(sanitized).length > 64_000) {
    throw new Error('board_filters is too large');
  }
  return sanitized;
}

export async function canonicalBoardColumns(projectId: number, visibleSectionIds: unknown) {
  if (!Array.isArray(visibleSectionIds)) {
    throw new Error('visible_section_ids must be an array');
  }
  if (visibleSectionIds.some((id) =>
    typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('visible_section_ids must contain positive integers');
  }
  const ids = [...new Set(visibleSectionIds as number[])];
  const sections = await prisma.section.findMany({
    where: { projectId, deleted: false },
    select: { id: true, section_title: true, projectId: true, ranking: true, isDone: true, deleted: true },
    orderBy: [{ ranking: 'asc' }, { id: 'asc' }],
  });
  const existing = new Set(sections.map((section) => section.id));
  const missing = ids.find((id) => !existing.has(id));
  if (missing !== undefined) throw new Error(`section ${missing} does not belong to this board`);
  const visible = new Set(ids);
  return sections.map((section) => ({
    ...section,
    title: section.section_title,
    visibility: visible.has(section.id),
  }));
}
