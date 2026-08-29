import { IProject } from "@/models/model";
import { NextApiResponse } from "next";

/**
 * returns the default board's columns from DEFAULT view. or project.sections as complete fallback
 *
 * @export
 * @param {IProject} project
 * @return {*} 
 */
export function returnActiveOrDefaultColumnSections(project: IProject) {
    var sections:any = [];

    if (project.project_view?.default_view?.board_columns_view){
        sections = project.project_view?.default_view?.board_columns_view
    }
    else {
        sections = project.section
    }

    return sections

}




export function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes"
  
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
  
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }
  

/**
 * Validates that a query parameter can be converted to a valid integer
 * 
 * @param param The parameter to validate (from req.query)
 * @param paramName The name of the parameter (for error messages)
 * @param res The response object to return errors
 * @returns The validated integer or null if validation failed
 */
export function validateIntegerParam(
    param: string | string[] | undefined,
    paramName: string,
    res: NextApiResponse
): number | null {
    // Check if parameter exists
    if (!param) {
        res.status(400).json({ error: `Missing required parameter: ${paramName}` });
        return null;
    }
    
    // Handle potential array from query parameters
    const value = Array.isArray(param) ? param[0] : param;
    
    // Convert to number and validate
    const parsedValue = Number(value);
    
    // Ensure it's a valid integer
    if (!Number.isInteger(parsedValue) || isNaN(parsedValue)) {
        res.status(400).json({ error: `${paramName} must be a valid integer` });
        return null;
    }
    
    return parsedValue;
}
// types.ts (if you'd like to split types later)
export interface ExtractedContent {
  mentions: string[];
  agentMentions: string[];
  src: string[];
}

/**
 * Removes the contents of every <blockquote> (nested ones included) from HTML.
 * Mentions living inside a quoted reply must NOT re-notify the mentioned user or
 * re-trigger a mentioned agent: otherwise the agent replies quoting the mention,
 * which re-triggers it, looping forever. Callers strip blockquotes before
 * extracting mentions for triggering. Depth-aware so multiple and nested
 * blockquotes, and real mentions interleaved between them, are handled
 * correctly. Server-safe (regex only, no DOM).
 */
export function stripBlockquoteContent(htmlContent: string): string {
  let out = "";
  let depth = 0;
  let lastIndex = 0;
  const tagRegex = /<(\/?)blockquote\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(htmlContent)) !== null) {
    if (depth === 0) out += htmlContent.slice(lastIndex, m.index);
    if (m[1] === "/") {
      if (depth > 0) depth--;
    } else {
      depth++;
    }
    lastIndex = tagRegex.lastIndex;
  }
  if (depth === 0) out += htmlContent.slice(lastIndex);
  return out;
}

// extractTipTapContent.ts
export function extractTipTapContent(htmlContent: string): ExtractedContent {
  const mentions: string[] = [];
  const agentMentions: string[] = [];
  const src: string[] = [];

  const mentionRegex = /<span[^>]*data-type=["']mention["'][^>]*data-label=["']name-(\d+)["'][^>]*>/gi;
  let mentionMatch: RegExpExecArray | null;

  const pushIntoMentions = (id:number)=>{
    mentions.push(id.toString())
  }

  while ((mentionMatch = mentionRegex.exec(htmlContent)) !== null) {
    const id = parseInt(mentionMatch[1], 10);
    if (!mentions.includes(id.toString())) {
      pushIntoMentions(id);
    }
  }

  const mentionRegexAlt = /<span[^>]*data-label=["']name-(\d+)["'][^>]*data-type=["']mention["'][^>]*>/gi;
  let mentionMatchAlt: RegExpExecArray | null;

  while ((mentionMatchAlt = mentionRegexAlt.exec(htmlContent)) !== null) {
    const id = parseInt(mentionMatchAlt[1], 10);
    if (!mentions.includes(id.toString())) {
      pushIntoMentions(id);
    }
  }

  const agentMentionRegex = /<span[^>]*data-type=["']mention["'][^>]*data-label=["']agent-([^"']+)["'][^>]*>/gi;
  let agentMentionMatch: RegExpExecArray | null;

  while ((agentMentionMatch = agentMentionRegex.exec(htmlContent)) !== null) {
    const id = agentMentionMatch[1];
    if (!agentMentions.includes(id)) {
      agentMentions.push(id);
    }
  }

  const agentMentionRegexAlt = /<span[^>]*data-label=["']agent-([^"']+)["'][^>]*data-type=["']mention["'][^>]*>/gi;
  let agentMentionMatchAlt: RegExpExecArray | null;

  while ((agentMentionMatchAlt = agentMentionRegexAlt.exec(htmlContent)) !== null) {
    const id = agentMentionMatchAlt[1];
    if (!agentMentions.includes(id)) {
      agentMentions.push(id);
    }
  }

  const srcRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let srcMatch: RegExpExecArray | null;

  while ((srcMatch = srcRegex.exec(htmlContent)) !== null) {
    const imageSrc = srcMatch[1];
    if (!src.includes(imageSrc)) {
      src.push(imageSrc);
    }
  }

  return { mentions, agentMentions, src };
}
