// Turns a failed AI Task Writer / Write With AI response into something the user can act on.
//
// Lives outside the hook so it can be tested: importing the hook pulls in the Recoil store
// and React components, which the test runner cannot load.
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
