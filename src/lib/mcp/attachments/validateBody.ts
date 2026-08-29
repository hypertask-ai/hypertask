import { createHash } from 'node:crypto';
import {
  MCP_ATTACHMENT_MAX_BYTES,
  MCP_ATTACHMENT_MAX_FILES,
  MCP_ATTACHMENT_MAX_INLINE_BYTES,
  isAllowedMime,
  normalizeMime,
} from './constants';
import { bufferMatchesDeclaredMime } from './magicBytes';
import { hasUnpairedUtf16Surrogate } from './filename';

export type ValidatedFileSpec =
  | { kind: 'data'; filename: string; contentType: string; buffer: Buffer }
  | { kind: 'url'; filename: string; contentType: string; url: string };

export function validatedFileIdentity(file: ValidatedFileSpec): string {
  return file.kind === 'data'
    ? `content\0${createHash('sha256').update(file.buffer).digest('hex')}`
    : `url\0${new URL(file.url).toString()}`;
}

export function assertNoDuplicateValidatedFiles(
  files: ValidatedFileSpec[]
): void {
  const seen = new Map<string, number>();
  files.forEach((file, index) => {
    const identity = validatedFileIdentity(file);
    const firstIndex = seen.get(identity);
    if (firstIndex !== undefined) {
      reject(`files[${index}] duplicates files[${firstIndex}]`);
    }
    seen.set(identity, index);
  });
}

export function reject(message: string): never {
  const e = new Error(message);
  (e as Error & { status?: number }).status = 400;
  throw e;
}

function assertFilename(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    reject('Each file requires a non-empty filename');
  }
  if (name.length > 255) reject('filename must be 255 characters or less');
  const trimmed = name.trim();
  if (hasUnpairedUtf16Surrogate(trimmed)) reject('filename must be valid Unicode');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    reject('filename must not contain path segments');
  }
  return trimmed;
}

function assertContentType(ct: unknown): string {
  if (typeof ct !== 'string' || ct.trim().length === 0) {
    reject('Each file requires content_type');
  }
  if (ct.length > 128) reject('content_type must be 128 characters or less');
  const normalized = normalizeMime(ct);
  if (!isAllowedMime(normalized)) {
    reject(`Unsupported content_type: ${normalized}`);
  }
  return normalized;
}

export const MCP_ATTACHMENT_MAX_BASE64_CHARACTERS =
  Math.ceil(MCP_ATTACHMENT_MAX_INLINE_BYTES / 3) * 4;
export const MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS =
  MCP_ATTACHMENT_MAX_BASE64_CHARACTERS + 64 * 1024;

export function decodeBase64Data(data: string, index: number): Buffer {
  const trimmed = data.trim();
  if (trimmed.startsWith('data:')) {
    reject(`files[${index}].data must be raw base64, not a data: URL`);
  }
  if (trimmed.length > MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS) {
    reject(`files[${index}] exceeds inline decoded limit (${MCP_ATTACHMENT_MAX_INLINE_BYTES} bytes); use url for larger files`);
  }
  const normalized = trimmed.replace(/[\t\n\f\r ]/g, '');
  if (normalized.length > MCP_ATTACHMENT_MAX_BASE64_CHARACTERS) {
    reject(`files[${index}] exceeds inline decoded limit (${MCP_ATTACHMENT_MAX_INLINE_BYTES} bytes); use url for larger files`);
  }
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    reject(`files[${index}].data is not valid base64`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(normalized, 'base64');
  } catch {
    reject(`files[${index}].data is not valid base64`);
  }
  if (buf.length === 0 && normalized.length > 0) {
    reject(`files[${index}].data is not valid base64`);
  }
  if (
    buf.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')
  ) {
    reject(`files[${index}].data is not valid base64`);
  }
  if (buf.length > MCP_ATTACHMENT_MAX_INLINE_BYTES) {
    reject(`files[${index}] exceeds inline decoded limit (${MCP_ATTACHMENT_MAX_INLINE_BYTES} bytes); use url for larger files`);
  }
  return buf;
}

function assertHttpUrl(urlRaw: unknown, index: number): string {
  if (typeof urlRaw !== 'string' || urlRaw.trim().length === 0) {
    reject(`files[${index}].url must be a non-empty string`);
  }
  if (urlRaw.length > 4096) {
    reject(`files[${index}].url must be 4096 characters or less`);
  }
  let u: URL;
  try {
    u = new URL(urlRaw.trim());
  } catch {
    reject(`files[${index}].url is not a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    reject(`files[${index}].url must use http or https`);
  }
  if (u.username || u.password) {
    reject(`files[${index}].url must not include credentials`);
  }
  return u.toString();
}

function dataKeysPresent(v: unknown): boolean {
  return v !== undefined && v !== null;
}

export interface ParsedAttachmentsBody {
  task_id?: number;
  ticket_number?: string;
  unique_index?: number;
  project_id?: number;
  comment_id?: number;
  files: ValidatedFileSpec[];
}

/**
 * Parse and validate JSON body for POST /api/mcp/tasks/attachments.
 * Throws Error with status 400 on failure.
 */
export function parseAndValidateAttachmentsBody(body: unknown): ParsedAttachmentsBody {
  if (body === null || typeof body !== 'object') {
    reject('Request body must be a JSON object');
  }
  const o = body as Record<string, unknown>;
  const allowedBodyFields = new Set([
    'task_id',
    'ticket_number',
    'unique_index',
    'project_id',
    'comment_id',
    'files',
  ]);
  const unknownBodyField = Object.keys(o).find((key) => !allowedBodyFields.has(key));
  if (unknownBodyField) reject(`Unknown request field: ${unknownBodyField}`);

  const hasTaskId = o.task_id !== undefined && o.task_id !== null;
  const hasTicket =
    o.ticket_number !== undefined && o.ticket_number !== null && String(o.ticket_number).trim() !== '';
  const hasUniqueIndex = o.unique_index !== undefined && o.unique_index !== null;
  const hasProjectId = o.project_id !== undefined && o.project_id !== null;

  if (hasUniqueIndex && !hasProjectId) {
    reject('project_id and unique_index must be provided together');
  }
  if (hasProjectId && !hasUniqueIndex && !hasTicket) {
    reject('project_id is only valid with ticket_number or unique_index');
  }
  const identifierCount = [hasTaskId, hasTicket, hasUniqueIndex].filter(Boolean).length;
  if (identifierCount !== 1) {
    reject('Provide exactly one of task_id, ticket_number, or (project_id + unique_index)');
  }

  let task_id: number | undefined;
  if (hasTaskId) {
    const tid = o.task_id;
    if (typeof tid !== 'number' || !Number.isInteger(tid) || tid < 1) {
      reject('task_id must be a positive integer');
    }
    task_id = tid;
  }

  let ticket_number: string | undefined;
  if (hasTicket) {
    const tn = String(o.ticket_number).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(tn)) {
      reject('Invalid ticket_number format');
    }
    ticket_number = tn;
  }

  let unique_index: number | undefined;
  let project_id: number | undefined;
  if (hasUniqueIndex) {
    if (
      typeof o.unique_index !== 'number' ||
      !Number.isInteger(o.unique_index) ||
      o.unique_index < 1
    ) {
      reject('unique_index must be a positive integer');
    }
    unique_index = o.unique_index;
  }
  if (hasProjectId) {
    if (typeof o.project_id !== 'number' || !Number.isInteger(o.project_id) || o.project_id < 1) {
      reject('project_id must be a positive integer');
    }
    project_id = o.project_id;
  }

  let comment_id: number | undefined;
  if (o.comment_id !== undefined && o.comment_id !== null) {
    const cid = o.comment_id;
    if (typeof cid !== 'number' || !Number.isInteger(cid) || cid < 1) {
      reject('comment_id must be a positive integer when provided');
    }
    comment_id = cid;
  }

  if (!Array.isArray(o.files)) {
    reject('files must be a non-empty array');
  }
  const filesRaw = o.files as unknown[];
  if (filesRaw.length === 0) {
    reject('files must contain at least one item');
  }
  if (filesRaw.length > MCP_ATTACHMENT_MAX_FILES) {
    reject(`At most ${MCP_ATTACHMENT_MAX_FILES} files per request`);
  }
  const totalInlineInputCharacters = filesRaw.reduce<number>((total, item) => {
    if (item === null || typeof item !== 'object') return total;
    const data = (item as Record<string, unknown>).data;
    return total + (typeof data === 'string' ? data.length : 0);
  }, 0);
  if (totalInlineInputCharacters > MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS) {
    reject(
      `Total inline attachment input exceeds ${MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS} characters; use url for larger files`
    );
  }

  const files: ValidatedFileSpec[] = [];

  for (let i = 0; i < filesRaw.length; i++) {
    const item = filesRaw[i];
    if (item === null || typeof item !== 'object') {
      reject(`files[${i}] must be an object`);
    }
    const f = item as Record<string, unknown>;
    const allowedFileFields = new Set(['filename', 'content_type', 'data', 'url']);
    const unknownFileField = Object.keys(f).find((key) => !allowedFileFields.has(key));
    if (unknownFileField) {
      reject(`Unknown files[${i}] field: ${unknownFileField}`);
    }

    const filename = assertFilename(f.filename);
    const contentType = assertContentType(f.content_type);

    const hasData = dataKeysPresent(f.data);
    const hasUrl = dataKeysPresent(f.url) && String(f.url).trim() !== '';

    if (hasData && hasUrl) {
      reject(`files[${i}]: provide exactly one of data or url`);
    }
    if (!hasData && !hasUrl) {
      reject(`files[${i}]: exactly one of data or url is required`);
    }

    if (hasData) {
      if (typeof f.data !== 'string') {
        reject(`files[${i}].data must be a string`);
      }
      const buffer = decodeBase64Data(f.data, i);
      if (!bufferMatchesDeclaredMime(buffer, contentType)) {
        reject(`files[${i}] content does not match content_type ${contentType}`);
      }
      files.push({ kind: 'data', filename, contentType, buffer });
    } else {
      const url = assertHttpUrl(f.url, i);
      files.push({ kind: 'url', filename, contentType, url });
    }
  }

  const inlineBytes = files.reduce(
    (total, file) => total + (file.kind === 'data' ? file.buffer.length : 0),
    0
  );
  if (inlineBytes > MCP_ATTACHMENT_MAX_INLINE_BYTES) {
    reject(
      `Total inline attachment data exceeds ${MCP_ATTACHMENT_MAX_INLINE_BYTES} decoded bytes; use url for larger files`
    );
  }

  assertNoDuplicateValidatedFiles(files);

  return { task_id, ticket_number, unique_index, project_id, comment_id, files };
}
