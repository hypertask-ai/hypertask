import { IProject } from "@/models/model";
import { NextApiResponse } from "next";
import { parse } from "node-html-parser";

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
  const mentions = new Set<string>();
  const agentMentions = new Set<string>();
  const sources = new Set<string>();
  const root = parse(htmlContent);

  for (const span of root.querySelectorAll("span")) {
    if (span.getAttribute("data-type") !== "mention") continue;

    const label = span.getAttribute("data-label") ?? "";
    const userMatch = /^name-(\d+)$/.exec(label);
    if (userMatch) {
      mentions.add(userMatch[1]);
    } else if (label.startsWith("agent-") && label.length > "agent-".length) {
      agentMentions.add(label.slice("agent-".length));
    }
  }

  for (const image of root.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (source) sources.add(source);
  }

  return {
    mentions: [...mentions],
    agentMentions: [...agentMentions],
    src: [...sources],
  };
}
