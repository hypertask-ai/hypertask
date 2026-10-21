import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Module from "node:module";
import { FeatureFlagProvider } from "../src/hooks/useFlag";
import flag, { HTPR_7350_CARD_TITLE_WRAP_FLAG } from "../src/lib/flags/definitions/htpr-7350-card-title-wrap";

const extensions = (Module as unknown as { _extensions: Record<string, (module: { exports: unknown }) => void> })._extensions;
extensions[".scss"] = (module) => { module.exports = {}; };
extensions[".css"] = (module) => { module.exports = {}; };
const { TaskTitle } = require("../src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard") as typeof import("../src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard");

const SeededFlags = FeatureFlagProvider as React.FC<Omit<React.ComponentProps<typeof FeatureFlagProvider>, "children"> & { children?: React.ReactNode }>;
const title = "Long task title that keeps the board readable when it does wrap";

function renderTitle(flagOn: boolean): string {
  const client = new QueryClient();
  const initialFlags = {
    accountId: 985,
    evaluatedAt: "2026-10-19T00:00:00.000Z",
    values: { [HTPR_7350_CARD_TITLE_WRAP_FLAG]: flagOn },
  };
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        SeededFlags,
        { userId: 985, initialFlags },
        React.createElement(TaskTitle, { title }),
      ),
    ),
  );
}

function titleClasses(markup: string): string[] {
  const match = markup.match(/<p class="([^"]*)">/);
  assert.ok(match, `no title paragraph in ${markup}`);
  return match[1].split(" ");
}

test("with the flag on, card titles break only inside words too long for the card", () => {
  const classes = titleClasses(renderTitle(true));
  assert.ok(classes.includes("wrap-anywhere"));
  assert.ok(!classes.includes("break-all"));
});

test("with the flag off, card titles keep the old break-all wrapping", () => {
  const classes = titleClasses(renderTitle(false));
  assert.ok(classes.includes("break-all"));
  assert.ok(!classes.includes("wrap-anywhere"));
});

test("the title text is rendered unchanged either way", () => {
  assert.ok(renderTitle(true).includes(title));
  assert.ok(renderTitle(false).includes(title));
});

test("the fix ships as a bugfix flag", () => {
  assert.equal(flag.key, HTPR_7350_CARD_TITLE_WRAP_FLAG);
  assert.equal(flag.kind, "bugfix");
});
