const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

// Recorded before this slice at commit 33c5a4ad1a05b375185b42a6c1bd7b7115d63514.
const baseline = [
  "src/components/Modals/Sheets/AppSheet.tsx(2,17): error TS2305: Module '\"react-modal-sheet\"' has no exported member 'useScrollPosition'.",
  "src/components/Modals/Sheets/AppSheet.tsx(147,7): error TS2322: Type 'SheetDetent' is not assignable to type 'SheetDetent | undefined'.",
  "src/components/Modals/Sheets/AppSheet.tsx(170,13): error TS2322: Type '{ children: ReactNode; disableScroll: boolean; disableDrag: boolean; scrollClassName: string; }' is not assignable to type 'IntrinsicAttributes & Omit<CommonProps, \"drag\" | \"onDrag\" | \"onDragEnd\" | \"onDragStart\" | \"dragConstraints\" | \"dragElastic\" | \"dragMomentum\"> & { ...; } & RefAttributes<...>'.",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx(40,49): error TS7006: Parameter 'member' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(207,75): error TS7006: Parameter 'section' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(209,56): error TS7006: Parameter 'task' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(216,27): error TS7006: Parameter 'taskLabel' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(217,30): error TS7006: Parameter 'label' implicitly has an 'any' type.",
  "src/hooks/MultiPages/Tasks/useTagsModal.ts(53,56): error TS7006: Parameter 'id' implicitly has an 'any' type.",
  "src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx(126,62): error TS7006: Parameter 'sec' implicitly has an 'any' type.",
  "src/lib/mcp-server/streamable-http.ts(13,31): error TS2339: Property 'http' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(19,41): error TS2339: Property 'mcpReq' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(28,36): error TS2353: Object literal may only specify known properties, and 'verboseLogs' does not exist in type 'ServerOptions'.",
  "src/lib/redis.ts(45,26): error TS2769: No overload matches this call.",
  "src/lib/state.tsx(8,3): error TS2305: Module '\"jotai\"' has no exported member 'useAtomValueRawSync'."
];
const result = spawnSync("npx", ["tsc", "--noEmit", "-p", "."], { encoding: "utf8", timeout: 180000 });
if (result.error) throw result.error;
// TypeScript 6 uses exit 1 for diagnostics; the native compiler uses exit 2.
assert.ok([0, 1, 2].includes(result.status), `Unexpected TypeScript exit: ${result.status}`);
assert.equal(result.stderr.trim(), "", "Unexpected compiler stderr is not a baseline diagnostic");
const diagnostics = result.stdout.split(/\r?\n/).filter((line) => line.includes("error TS"));
const newDiagnostics = diagnostics.filter((line) => !baseline.includes(line));
assert.deepEqual(newDiagnostics, [], "New TypeScript diagnostics are not allowed");
assert.ok(result.status === 0 || diagnostics.length > 0, "Compiler failure must have known diagnostics");
console.log(`TypeScript slice verified: ${diagnostics.length} pre-existing diagnostics, 0 new; tsc exit ${result.status}`);
