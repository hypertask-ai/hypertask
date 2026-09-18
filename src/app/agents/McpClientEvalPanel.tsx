"use client";

import { useEffect, useState } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6533_MCP_CLIENT_EVAL_FLAG } from "@/lib/flags/keys";
import type {
  McpClientEvalClient,
  McpClientEvalReport,
  McpClientEvalTransport,
  McpClientEvalUsageSource,
} from "@/lib/mcpClientEval/types";

const CLIENTS: McpClientEvalClient[] = ["claude", "cursor", "codex"];
const TRANSPORTS: McpClientEvalTransport[] = ["mcp", "cli"];

function rate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function tokens(value: number | null, source?: McpClientEvalUsageSource): string {
  if (source === "unavailable" || value == null || !Number.isFinite(value)) return "—";
  if (source === "estimate") return `est. ${value}`;
  return String(value);
}

function time(value: number | null, source?: string): string {
  if (source === "unavailable" || value == null || !Number.isFinite(value)) return "—";
  return `${value} ms`;
}

function calls(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : String(value);
}

function McpClientEvalPanel() {
  const enabled = useFlag(HTPR_6533_MCP_CLIENT_EVAL_FLAG);
  const [report, setReport] = useState<McpClientEvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/agents/mcp-client-eval")
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Could not load the eval report");
        const body = (await response.json()) as {
          success: boolean;
          report?: McpClientEvalReport;
        };
        return body.report ?? null;
      })
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || (!report && !error)) return null;

  return (
    <section className="mt-6">
      <h2 className="text-dense font-medium text-text-light-gray mb-3">
        MCP client eval
      </h2>
      {error && <p className="text-dense text-destructive">{error}</p>}
      {report && (
        <>
          <p className="mb-3 text-dense text-text-light-gray">
            {report.label} · {new Date(report.generatedAt).toLocaleString()} ·{" "}
            {report.rows.length > 0
              ? `${rate(report.summary.successRate)} pass`
              : report.summary.byTransport
                ? `MCP ${rate(report.summary.byTransport.mcp.successRate)} · CLI ${rate(report.summary.byTransport.cli.successRate)}`
                : "client measurements unavailable"}
            {report.summary.byTransport && (
              <>
                {" "}
                · MCP {time(report.summary.byTransport.mcp.wallMs, "measured")} · CLI{" "}
                {time(report.summary.byTransport.cli.wallMs, "measured")}
              </>
            )}
          </p>
          {report.summary.byTransport && (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-left text-dense">
                <thead>
                  <tr className="text-text-light-gray">
                    <th className="py-1.5 pr-3 font-medium">Path</th>
                    <th className="py-1.5 pr-3 font-medium">Pass</th>
                    <th className="py-1.5 pr-3 font-medium">Time</th>
                    <th className="py-1.5 font-medium">Tool calls</th>
                  </tr>
                </thead>
                <tbody>
                  {TRANSPORTS.map((transport) => {
                    const slice = report.summary.byTransport?.[transport];
                    if (!slice) return null;
                    return (
                      <tr
                        key={transport}
                        className="border-t border-border-light-gray-thin"
                      >
                        <td className="py-1.5 pr-3 uppercase">{transport}</td>
                        <td className="py-1.5 pr-3">{rate(slice.successRate)}</td>
                        <td className="py-1.5 pr-3">
                          {time(slice.wallMs, "measured")}
                        </td>
                        <td className="py-1.5">{calls(slice.toolCalls)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {report.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-dense">
              <thead>
                <tr className="text-text-light-gray">
                  <th className="py-1.5 pr-3 font-medium">Client</th>
                  <th className="py-1.5 pr-3 font-medium">Path</th>
                  <th className="py-1.5 pr-3 font-medium">Pass</th>
                  <th className="py-1.5 pr-3 font-medium">Tokens in</th>
                  <th className="py-1.5 pr-3 font-medium">Tokens out</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 font-medium">Tool calls</th>
                </tr>
              </thead>
              <tbody>
                {CLIENTS.flatMap((client) =>
                  TRANSPORTS.map((transport) => {
                    const slice = report.summary.byClient[client]?.[transport];
                    if (!slice || slice.tasks === 0) return null;
                    return (
                      <tr
                        key={`${client}-${transport}`}
                        className="border-t border-border-light-gray-thin"
                      >
                        <td className="py-1.5 pr-3 capitalize">{client}</td>
                        <td className="py-1.5 pr-3 uppercase">{transport}</td>
                        <td className="py-1.5 pr-3">{rate(slice.successRate)}</td>
                        <td className="py-1.5 pr-3">
                          {tokens(slice.tokensIn, slice.usageSource)}
                        </td>
                        <td className="py-1.5 pr-3">
                          {tokens(slice.tokensOut, slice.usageSource)}
                        </td>
                        <td className="py-1.5 pr-3">
                          {time(slice.wallMs, slice.wallSource)}
                        </td>
                        <td className="py-1.5">{calls(slice.toolCalls)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          )}
          {report.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-dense">
              <thead>
                <tr className="text-text-light-gray">
                  <th className="py-1.5 pr-3 font-medium">Task</th>
                  <th className="py-1.5 pr-3 font-medium">Client</th>
                  <th className="py-1.5 pr-3 font-medium">Path</th>
                  <th className="py-1.5 pr-3 font-medium">Result</th>
                  <th className="py-1.5 pr-3 font-medium">In</th>
                  <th className="py-1.5 pr-3 font-medium">Out</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr
                    key={`${row.taskId}-${row.client}-${row.transport}`}
                    className="border-t border-border-light-gray-thin"
                  >
                    <td className="py-1.5 pr-3">{row.taskId}</td>
                    <td className="py-1.5 pr-3 capitalize">{row.client}</td>
                    <td className="py-1.5 pr-3 uppercase">{row.transport}</td>
                    <td className="py-1.5 pr-3">{row.pass ? "pass" : "fail"}</td>
                    <td className="py-1.5 pr-3">
                      {tokens(row.tokensIn, row.usageSource)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {tokens(row.tokensOut, row.usageSource)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {time(row.wallMs, row.wallSource)}
                    </td>
                    <td className="py-1.5">{calls(row.toolCalls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}
    </section>
  );
}

export default McpClientEvalPanel;
