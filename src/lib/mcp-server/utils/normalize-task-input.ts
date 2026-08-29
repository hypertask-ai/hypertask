/**
 * Utility to normalize task identification inputs
 * Handles URL parsing and ticket number extraction
 * 
 * Key protections:
 * 1. URLs are parsed to extract project_id + unique_index
 * 2. Ticket numbers (like "HTPR-3272") are extracted from text strings
 */

import { parseHypertaskUrl } from './task-parser';

/**
 * Normalizes task identification input by parsing URLs
 * If a URL is detected, it extracts project_id and unique_index
 * and removes any conflicting task_id values
 * 
 * @param input - Raw input object that may contain URLs or incorrect task_id values
 * @returns Normalized input with proper project_id and unique_index if URL was found
 */
/**
 * Coerce task_id from string to number (Claude sometimes sends "20706" instead of 20706)
 * Fixes HTPR-3618: Claude stringifies params even when tool specifies integer
 */
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
  // move_task_between_boards
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

  // Only ticket_number is a string task identifier. Other string fields are
  // user content and may legitimately contain task links or ticket numbers.
  for (const [key, value] of Object.entries(normalized)) {
    if (key !== 'ticket_number') {
      continue;
    }
    
    if (typeof value === 'string' && value.trim()) {
      const trimmedValue = value.trim();
      
      // Check for URL
      const urlParse = parseHypertaskUrl(trimmedValue);
      if (urlParse && urlParse.projectId && urlParse.uniqueIndex) {
        urlFound = true;
        urlParseResult = {
          projectId: urlParse.projectId,
          uniqueIndex: urlParse.uniqueIndex,
        };
        // The URL field has been consumed into project_id + unique_index.
        delete normalized[key];
        break;
      }
      
      // Check for ticket number pattern (e.g., "HTPR-3272" or "HTPR-3272 | Build MCP Server")
      // Extract ticket number from text if it contains one
      const extractedTicket = extractTicketNumber(trimmedValue);
      if (extractedTicket && !ticketNumberFound) {
        ticketNumberFound = extractedTicket;
        // If this field is not already ticket_number, and we don't have one, set it
        if (key !== 'ticket_number' && !normalized.ticket_number) {
          (normalized as any).ticket_number = extractedTicket;
          // Remove the original field if it was just the ticket number
          if (trimmedValue === extractedTicket || trimmedValue.toUpperCase() === extractedTicket) {
            delete normalized[key];
          }
        }
      }
    }
  }

  // If we found a URL, use it to set project_id + unique_index
  // and remove any conflicting task_id
  if (urlFound && urlParseResult) {
    (normalized as any).project_id = urlParseResult.projectId;
    (normalized as any).unique_index = urlParseResult.uniqueIndex;
    
    // Remove task_id if it exists (it might have been incorrectly extracted from the URL)
    if ((normalized as any).task_id !== undefined) {
      delete (normalized as any).task_id;
    }
    
    // Also handle array case
    if (Array.isArray((normalized as any).task_id)) {
      delete (normalized as any).task_id;
    }
  }

  // Handle array case (for get_tasks with multiple IDs)
  if (Array.isArray((normalized as any).task_id) && (normalized as any).task_id.length > 0) {
    // Check if any element might be a URL string
    const urlIndices: number[] = [];
    (normalized as any).task_id.forEach((id: any, index: number) => {
      if (typeof id === 'string') {
        const urlParse = parseHypertaskUrl(id);
        if (urlParse && urlParse.projectId && urlParse.uniqueIndex) {
          urlIndices.push(index);
        }
      }
    });

    // If we found URLs in the array, we need to handle them
    // For now, we'll note that arrays with URLs need special handling
    // This is a more complex case that might need separate tool calls
  }

  return normalized;
}

/**
 * Extracts ticket number from a text string
 * Handles formats like:
 * - "HTPR-3272"
 * - "HTPR-3272 | Build MCP Server"
 * - "Task HTPR-3272: Description"
 * 
 * @param text - Text that may contain a ticket number
 * @returns Ticket number if found, null otherwise
 */
export function extractTicketNumber(text: string): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  
  const trimmed = text.trim();
  
  // First, check if the entire string is a ticket number
  if (/^[A-Z0-9]+-\d+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  
  // Try to find ticket number pattern in the text
  // Look for patterns like "HTPR-3272" (alphanumeric prefix, dash, digits)
  const ticketMatch = trimmed.match(/\b([A-Z0-9]{2,}-\d+)\b/i);
  if (ticketMatch) {
    const potentialTicket = ticketMatch[1].toUpperCase();
    // Verify it's a valid ticket number format
    if (/^[A-Z0-9]+-\d+$/i.test(potentialTicket)) {
      return potentialTicket;
    }
  }
  
  return null;
}

/**
 * Normalizes create_task input.
 * Coerces project_id and section_id from strings to numbers (AI agents sometimes pass "1511" instead of 1511).
 * Fixes "Project identifier is required" errors when the backend rejects string IDs.
 */
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

/**
 * Checks if an input value might be a URL that needs parsing
 * @param value - Value to check
 * @returns True if value looks like a HyperTasks URL
 */
export function isHypertaskUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return parseHypertaskUrl(value) !== null;
}
