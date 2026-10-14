
import { parseHypertaskUrl } from './task-parser';

function coerceTaskIdInput<T extends Record<string, any>>(obj: T): void {
  if (obj.task_id !== undefined) {
    if (Array.isArray(obj.task_id)) {
      (obj as any).task_id = obj.task_id.map((id: unknown) =>
        typeof id === 'string' ? parseInt(id, 10) : id
      );
    } else if (typeof obj.task_id === 'string') {
      (obj as any).task_id = parseInt(obj.task_id, 10);
    }
  }
  if (obj.unique_index !== undefined && typeof obj.unique_index === 'string') {
    (obj as any).unique_index = parseInt(obj.unique_index, 10);
  }
  if (obj.project_id !== undefined && typeof obj.project_id === 'string') {
    (obj as any).project_id = parseInt(obj.project_id, 10);
  }
  if (obj.target_project_id !== undefined && typeof obj.target_project_id === 'string') {
    (obj as any).target_project_id = parseInt(obj.target_project_id, 10);
  }
  if (obj.target_section_id !== undefined && typeof obj.target_section_id === 'string') {
    (obj as any).target_section_id = parseInt(obj.target_section_id, 10);
  }
}

export function normalizeTaskInput<T extends Record<string, any>>(
  input: T
): T {
  const normalized = { ...input };
  coerceTaskIdInput(normalized);
  let urlFound = false;
  let urlParseResult: { projectId: number; uniqueIndex: number } | null = null;
  let ticketNumberFound: string | null = null;

  for (const [key, value] of Object.entries(normalized)) {
    if (key !== 'ticket_number') {
      continue;
    }
    
    if (typeof value === 'string' && value.trim()) {
      const trimmedValue = value.trim();
      
      const urlParse = parseHypertaskUrl(trimmedValue);
      if (urlParse && urlParse.projectId && urlParse.uniqueIndex) {
        urlFound = true;
        urlParseResult = {
          projectId: urlParse.projectId,
          uniqueIndex: urlParse.uniqueIndex,
        };
        delete normalized[key];
        break;
      }
      
      const extractedTicket = extractTicketNumber(trimmedValue);
      if (extractedTicket && !ticketNumberFound) {
        ticketNumberFound = extractedTicket;
        if (key !== 'ticket_number' && !normalized.ticket_number) {
          (normalized as any).ticket_number = extractedTicket;
          if (trimmedValue === extractedTicket || trimmedValue.toUpperCase() === extractedTicket) {
            delete normalized[key];
          }
        }
      }
    }
  }

  if (urlFound && urlParseResult) {
    (normalized as any).project_id = urlParseResult.projectId;
    (normalized as any).unique_index = urlParseResult.uniqueIndex;
    
    if ((normalized as any).task_id !== undefined) {
      delete (normalized as any).task_id;
    }
    
    if (Array.isArray((normalized as any).task_id)) {
      delete (normalized as any).task_id;
    }
  }

  if (Array.isArray((normalized as any).task_id) && (normalized as any).task_id.length > 0) {
    const urlIndices: number[] = [];
    (normalized as any).task_id.forEach((id: any, index: number) => {
      if (typeof id === 'string') {
        const urlParse = parseHypertaskUrl(id);
        if (urlParse && urlParse.projectId && urlParse.uniqueIndex) {
          urlIndices.push(index);
        }
      }
    });
  }

  return normalized;
}

export function extractTicketNumber(text: string): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  
  const trimmed = text.trim();
  
  if (/^[A-Z0-9]+-\d+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  
  const ticketMatch = trimmed.match(/\b([A-Z0-9]{2,}-\d+)\b/i);
  if (ticketMatch) {
    const potentialTicket = ticketMatch[1].toUpperCase();
    if (/^[A-Z0-9]+-\d+$/i.test(potentialTicket)) {
      return potentialTicket;
    }
  }
  
  return null;
}

export function normalizeCreateTaskInput<T extends Record<string, any>>(input: T): T {
  const normalized = { ...input };
  if (normalized.project_id !== undefined) {
    (normalized as any).project_id =
      typeof normalized.project_id === 'string'
        ? parseInt(normalized.project_id, 10)
        : normalized.project_id;
  }
  if (normalized.section_id !== undefined) {
    (normalized as any).section_id =
      typeof normalized.section_id === 'string'
        ? parseInt(normalized.section_id, 10)
        : normalized.section_id;
  }
  return normalized;
}

export function isHypertaskUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return parseHypertaskUrl(value) !== null;
}
