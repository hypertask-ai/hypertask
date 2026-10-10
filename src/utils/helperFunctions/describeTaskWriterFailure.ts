// Turns a failed AI Task Writer / Write With AI response into something the user can act on.
//
// Lives outside the hook so it can be tested: importing the hook pulls in the Recoil store
// and React components, which the test runner cannot load.
export function describeTaskWriterStreamFailure(text: string): string | null {
  for (const match of text.matchAll(/event: error\r?\ndata: ([^\r\n]+)\r?\n\r?\n/g)) {
    try {
      const error = JSON.parse(match[1]);
      // These markers are emitted only by the HTPR-7060 and HTPR-7077 server gates.
      if ((error.code === "empty-task-writer-draft" || error.code === "task-writer-stream-error") && typeof error.content === "string") {
        return error.content;
      }
    } catch {
      // Incomplete or non-JSON frames are not this flagged error.
    }
  }
  return null;
}

export async function describeTaskWriterFailure(
  response: Response
): Promise<string> {
  // 413 is the platform rejecting the request body before it reaches the route, so there is
  // no JSON to read and nothing in our logs. Say what to do rather than what broke.
  if (response.status === 413) {
    return "This task is too large to send to the AI. Large images pasted into the description are the usual cause: remove one, or attach it as a file instead.";
  }
  try {
    const body = await response.json();
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Not JSON (an HTML error page, or an empty body) — fall through to the status line.
  }
  return `The AI request failed (${response.status}). Please try again.`;
}
