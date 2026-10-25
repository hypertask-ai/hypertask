import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { getGetTasksBaseSchema } from "../src/lib/mcp-server/validations/task.validation";
import { actionableToolError } from "../src/lib/mcp-server/tool-response";
import { describeFieldSuggestions, suggestKnownFields } from "../src/lib/mcp-server/fieldSuggestion";

const tasksSchema = getGetTasksBaseSchema();
const knownFields = Object.keys(tasksSchema.shape);

const reject = (input: Record<string, unknown>, hint: boolean) => {
  const parsed = tasksSchema.safeParse(input);
  assert.equal(parsed.success, false, "the real tasks schema must refuse this payload");
  const error = parsed.error!;
  return actionableToolError(
    new z.ZodError(
      error.issues.map((issue) => ({
        ...issue,
        ...(hint && issue.code === "unrecognized_keys"
          ? { suggestions: suggestKnownFields(issue.keys, knownFields) }
          : {}),
      })),
    ),
  );
};

test("the reported payload gets the field the caller meant", () => {
  const message = reject({ ticket_numbr: "HTPR-7841" }, true);
  assert.match(message, /Remove unsupported fields ticket_numbr/);
  assert.match(message, /Did you mean ticket_number instead of ticket_numbr\?/);
});

test("a nonsense field gets no suggestion", () => {
  const message = reject({ zzzznotafield: "x" }, true);
  assert.match(message, /Remove unsupported fields zzzznotafield/);
  assert.doesNotMatch(message, /Did you mean/);
});

test("a short typo does not collect a distant field name", () => {
  assert.doesNotMatch(reject({ limt: "5" }, true), /Did you mean (?!limit)/);
  assert.deepEqual(suggestKnownFields(["zz"], knownFields), {});
});

test("an exact allowed field is never suggested back", () => {
  assert.deepEqual(suggestKnownFields(["ticket_number"], knownFields), {});
});

test("the flag off keeps the message without a suggestion", () => {
  const message = reject({ ticket_numbr: "HTPR-7841" }, false);
  assert.equal(
    message,
    "Remove unsupported fields ticket_numbr from input; use only fields documented for this action.",
  );
});

test("suggestions read as one sentence per field", () => {
  assert.equal(
    describeFieldSuggestions({ ticket_numbr: "ticket_number" }),
    "Did you mean ticket_number instead of ticket_numbr?",
  );
  assert.equal(describeFieldSuggestions({}), "");
});
