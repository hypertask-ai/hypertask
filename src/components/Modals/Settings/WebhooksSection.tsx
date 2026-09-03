"use client";

import {
  ChevronDown,
  ExternalLink,
  RefreshCw,
  RotateCw,
  Send,
  Trash2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const API_URL = "/api/settings/webhooks";
const EVENTS = [
  "task.created",
  "task.updated",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "comment.mention",
] as const;

const inputClass =
  "h-10 w-full rounded-lg border-0 bg-comment-description px-3 text-dense font-medium text-white-black outline-none transition placeholder:text-text-light-gray focus:bg-modalBackground";
const chipClass =
  "rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray";

type ProjectRef = { id: number; name: string } | null;
type WorkspaceEndpoint = {
  id: string;
  kind: "workspace";
  scope: "team" | "project";
  project: ProjectRef;
  url: string;
  events: string[];
  active: boolean;
  secretHint: string;
  createdBy: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
};
type AgentEndpoint = {
  id: string;
  kind: "agent";
  scope: "team" | "project";
  project: ProjectRef;
  agent: { id: string; displayName: string };
  url: string;
  events: string[];
  active: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
};
type Endpoint = WorkspaceEndpoint | AgentEndpoint;
type Delivery = {
  deliveryId: string;
  event: string;
  payload: unknown;
  payloadHash: string | null;
  status: string;
  attemptNumber: number;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  attemptedAt: string;
};
type WebhooksResponse = {
  success?: boolean;
  endpoints?: Endpoint[];
  deliveries?: Delivery[];
  error?: string;
};

const relativeTime = (value: string | null) => {
  if (!value) return "No deliveries yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString();
};

const statusText = (statusCode: number | null, status: string) => {
  if (statusCode == null) return status;
  const labels: Record<number, string> = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
    500: "Server Error",
    502: "Bad Gateway",
    503: "Unavailable",
    504: "Gateway Timeout",
  };
  return `${statusCode}${labels[statusCode] ? ` ${labels[statusCode]}` : ""}`;
};

const endpointName = (endpoint: Endpoint) => {
  if (endpoint.kind === "agent") return endpoint.agent.displayName;
  try {
    return new URL(endpoint.url).hostname;
  } catch {
    return endpoint.url;
  }
};

export default function WebhooksSection() {
  const { projects, teamId } = useSettingsTeam();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [visiblePayload, setVisiblePayload] = useState<string | null>(null);

  const boards = useMemo(
    () =>
      projects
        .filter((project) => project.teamId === teamId)
        .map((project) => ({
          id: project.id,
          name: project.title ?? project.name ?? `Board ${project.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects, teamId],
  );
  const selected = endpoints.find(({ id }) => id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!teamId) {
      setEndpoints([]);
      setDeliveries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ teamId });
      if (selectedId) params.set("endpointId", selectedId);
      const response = await fetch(`${API_URL}?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as WebhooksResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load webhooks");
      }
      const nextEndpoints = data.endpoints ?? [];
      setEndpoints(nextEndpoints);
      setDeliveries(data.deliveries ?? []);
      if (selectedId && !nextEndpoints.some(({ id }) => id === selectedId)) {
        setSelectedId(nextEndpoints[0]?.id ?? null);
      } else if (!selectedId && nextEndpoints.length > 0) {
        setSelectedId(nextEndpoints[0].id);
      }
    } catch (error) {
      setEndpoints([]);
      setDeliveries([]);
      toast.error(error instanceof Error ? error.message : "Could not load webhooks");
    } finally {
      setLoading(false);
    }
  }, [selectedId, teamId]);

  useEffect(() => {
    setSelectedId(null);
    setRevealedSecret(null);
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const workspaceAction = async (
    action: "test" | "rotate" | "retry",
    endpoint: WorkspaceEndpoint,
    extra: Record<string, unknown> = {},
  ) => {
    if (!teamId) return;
    setBusy(`${action}:${endpoint.id}`);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, id: endpoint.id, action, ...extra }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        secret?: string;
        error?: string;
      };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `Could not ${action} webhook`);
      }
      if (data.secret) setRevealedSecret(data.secret);
      toast.success(
        action === "test"
          ? "Signed test queued"
          : action === "rotate"
            ? "Signing secret rotated"
            : "Delivery queued again",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Webhook action failed");
    } finally {
      setBusy(null);
    }
  };

  const agentAction = async (
    action: "test" | "replay",
    endpoint: AgentEndpoint,
    deliveryId?: string,
  ) => {
    setBusy(`${action}:${endpoint.id}`);
    try {
      const response = await fetch(`/api/agents/${endpoint.agent.id}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(deliveryId ? { deliveryId } : {}) }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not queue delivery");
      }
      toast.success(action === "test" ? "Signed test queued" : "Delivery queued again");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Webhook action failed");
    } finally {
      setBusy(null);
    }
  };

  const addEndpoint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!teamId || !url.trim() || events.length === 0) return;
    setBusy("create");
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          action: "create",
          url: url.trim(),
          projectId: projectId ? Number(projectId) : null,
          events,
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        endpoint?: WorkspaceEndpoint;
        secret?: string;
        error?: string;
      };
      if (!response.ok || !data.success || !data.endpoint || !data.secret) {
        throw new Error(data.error ?? "Could not add endpoint");
      }
      setRevealedSecret(data.secret);
      setSelectedId(data.endpoint.id);
      setUrl("");
      toast.success("Webhook endpoint added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add endpoint");
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (endpoint: WorkspaceEndpoint, active: boolean) => {
    if (!teamId) return;
    setBusy(`active:${endpoint.id}`);
    try {
      const response = await fetch(API_URL, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, id: endpoint.id, active }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not update endpoint");
      }
      await load();
      toast.success(active ? "Webhook enabled" : "Webhook paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update endpoint");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (endpoint: WorkspaceEndpoint) => {
    if (!teamId || !confirm("Delete this endpoint and its delivery history?")) return;
    setBusy(`delete:${endpoint.id}`);
    try {
      const response = await fetch(API_URL, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, id: endpoint.id }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not delete endpoint");
      }
      setSelectedId(null);
      setRevealedSecret(null);
      toast.success("Webhook endpoint deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete endpoint");
    } finally {
      setBusy(null);
    }
  };

  const retry = async (delivery: Delivery) => {
    if (!selected) return;
    if (selected.kind === "agent") {
      await agentAction("replay", selected, delivery.deliveryId);
      return;
    }
    await workspaceAction("retry", selected, {
      deliveryId: delivery.deliveryId,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <SettingsSectionShell title="Webhooks">
      <SettingsCard title="Outgoing webhooks">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Hypertask sends a signed request to your own URL the moment something
          happens in this team. No agent needed. Each endpoint has its own secret
          and delivery log.
        </p>
        <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
          <span className="font-semibold">Setup guide</span>
          <a
            className={cn(settingsActionButtonClass, "gap-1.5")}
            href="https://docs.hypertask.ai/mcp/agent-webhooks/"
            rel="noreferrer"
            target="_blank"
          >
            How webhooks work <ExternalLink size={13} strokeWidth={1.75} />
          </a>
        </div>
      </SettingsCard>

      {revealedSecret && (
        <SettingsCard title="New signing secret">
          <p className="px-2 font-semibold">
            Copy it now, it won&apos;t be shown again. Use it to verify the
            X-Hypertask-Signature header.
          </p>
          <SettingsCodeRow value={revealedSecret} />
        </SettingsCard>
      )}

      <SettingsCard title="Endpoints">
        {loading && endpoints.length === 0 ? (
          <p className="px-2 text-text-light-gray">Loading webhooks</p>
        ) : endpoints.length === 0 ? (
          <p className="px-2 text-text-light-gray">No endpoints yet</p>
        ) : (
          <div className="flex flex-col">
            {endpoints.map((endpoint) => {
              const active = endpoint.id === selectedId;
              return (
                <div
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0",
                    active && "rounded-[5px] bg-hover-active",
                  )}
                  key={`${endpoint.kind}:${endpoint.id}`}
                  onClick={() => setSelectedId(endpoint.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(endpoint.id);
                    }
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          aria-label={endpoint.lastDeliveryOk === false ? "Delivery failed" : "Endpoint active"}
                          className={cn(
                            "h-2 w-2 rounded-full",
                            endpoint.lastDeliveryOk === false
                              ? "bg-red-400"
                              : endpoint.lastDeliveryOk === true
                                ? "bg-green-500"
                                : "bg-text-light-gray",
                          )}
                        />
                        <p className="font-semibold">{endpointName(endpoint)}</p>
                        {endpoint.kind === "agent" ? (
                          <>
                            <span className={chipClass}>Owned by agent {endpoint.agent.displayName}</span>
                            <span className={chipClass}>{endpoint.events.length} events</span>
                          </>
                        ) : (
                          <>
                            <span className={chipClass}>{endpoint.events.length} events</span>
                            <span className={chipClass}>
                              {endpoint.project?.name ?? "All boards"}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="mt-1 truncate text-micro text-text-light-gray">
                        {endpoint.url}
                      </p>
                      <p className="mt-1 text-micro text-text-light-gray">
                        {endpoint.lastDeliveryAt
                          ? `Last delivery ${relativeTime(endpoint.lastDeliveryAt)}`
                          : "No deliveries yet"}
                        {endpoint.kind === "workspace"
                          ? ` · Secret ${endpoint.secretHint}${endpoint.createdBy ? ` · Added by ${endpoint.createdBy}` : ""}`
                          : " · Edit it from the agent's Manage panel"}
                      </p>
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {endpoint.kind === "workspace" ? (
                        <>
                          <label className="flex items-center gap-1.5 px-2 text-micro font-medium text-text-light-gray">
                            <input
                              checked={endpoint.active}
                              disabled={Boolean(busy)}
                              onChange={(event) => void setActive(endpoint, event.target.checked)}
                              type="checkbox"
                            />
                            Enabled
                          </label>
                          <button
                            className={cn(settingsActionButtonClass, "gap-1")}
                            disabled={Boolean(busy) || !endpoint.active}
                            onClick={() => void workspaceAction("test", endpoint)}
                            type="button"
                          >
                            <Send size={13} /> Send test
                          </button>
                          <button
                            className={cn(settingsActionButtonClass, "gap-1")}
                            disabled={Boolean(busy)}
                            onClick={() => void workspaceAction("rotate", endpoint)}
                            type="button"
                          >
                            <RotateCw size={13} /> Rotate secret
                          </button>
                          <button
                            className={cn(settingsActionButtonClass, "gap-1")}
                            disabled={Boolean(busy)}
                            onClick={() => void remove(endpoint)}
                            type="button"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={cn(settingsActionButtonClass, "gap-1")}
                            disabled={Boolean(busy) || !endpoint.active}
                            onClick={() => void agentAction("test", endpoint)}
                            type="button"
                          >
                            <Send size={13} /> Send test
                          </button>
                          <a
                            className={cn(settingsActionButtonClass, "gap-1")}
                            href={`/agents/${endpoint.agent.id}`}
                          >
                            Open agent <ExternalLink size={13} />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      {selected && (
        <SettingsCard title={`Recent deliveries · ${endpointName(selected)}`}>
          {deliveries.length === 0 ? (
            <p className="px-2 text-text-light-gray">
              No deliveries yet. Use Send test to verify the full path.
            </p>
          ) : (
            <div className="flex flex-col">
              {deliveries.map((delivery, index) => {
                const payloadKey = `${delivery.deliveryId}:${delivery.attemptNumber}:${index}`;
                return (
                  <div
                    className="border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
                    key={payloadKey}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              delivery.statusCode != null && delivery.statusCode >= 200 && delivery.statusCode < 300
                                ? "bg-green-500"
                                : delivery.status === "pending" || delivery.status === "processing"
                                  ? "bg-text-light-gray"
                                  : "bg-red-400",
                            )}
                          />
                          <span className="font-semibold">{delivery.event}</span>
                          <span className={chipClass}>
                            {statusText(delivery.statusCode, delivery.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-micro text-text-light-gray">
                          {new Date(delivery.attemptedAt).toLocaleString()}
                          {delivery.durationMs != null
                            ? ` · ${delivery.durationMs < 1000 ? `${delivery.durationMs} ms` : `${(delivery.durationMs / 1000).toFixed(1)} s`}`
                            : ""}
                          {delivery.attemptNumber > 0
                            ? ` · attempt ${delivery.attemptNumber} of 6`
                            : ""}
                          {delivery.payloadHash
                            ? ` · payload ${delivery.payloadHash.slice(0, 4)}…${delivery.payloadHash.slice(-4)}`
                            : ""}
                        </p>
                        {delivery.error && (
                          <p className="mt-1 text-micro text-red-400">{delivery.error}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          className={settingsActionButtonClass}
                          onClick={() =>
                            setVisiblePayload(
                              visiblePayload === payloadKey ? null : payloadKey,
                            )
                          }
                          type="button"
                        >
                          Payload
                        </button>
                        <button
                          className={cn(settingsActionButtonClass, "gap-1")}
                          disabled={Boolean(busy)}
                          onClick={() => void retry(delivery)}
                          type="button"
                        >
                          <RefreshCw size={13} /> Retry
                        </button>
                      </div>
                    </div>
                    {visiblePayload === payloadKey && (
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[5px] bg-comment-description p-3 font-mono text-micro text-white-black">
                        {JSON.stringify(delivery.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="px-2 text-micro text-text-light-gray">
            Retry queues the event with a fresh delivery ID. Automatic retries
            back off across 6 attempts over about 1 hour.
          </p>
        </SettingsCard>
      )}

      <SettingsCard title="Add endpoint">
        <form className="flex flex-col gap-4" onSubmit={addEndpoint}>
          <label className="flex flex-col gap-1.5 px-2">
            <span className="font-semibold">Endpoint URL</span>
            <input
              autoComplete="url"
              className={inputClass}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/hypertask"
              required
              type="url"
              value={url}
            />
            <span className="text-micro text-text-light-gray">
              Must be HTTPS. We POST JSON here and sign every request.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 px-2">
            <span className="font-semibold">Board scope</span>
            <span className="relative">
              <select
                className={cn(inputClass, "appearance-none pr-9")}
                onChange={(event) => setProjectId(event.target.value)}
                value={projectId}
              >
                <option value="">All boards in this team</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-light-gray"
                size={16}
              />
            </span>
          </label>
          <fieldset className="flex flex-col gap-2 px-2">
            <legend className="mb-1 font-semibold">Events</legend>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((eventName) => {
                const checked = events.includes(eventName);
                return (
                  <label
                    className={cn(
                      settingsActionButtonClass,
                      "cursor-pointer gap-1.5 bg-active-modal-element",
                      !checked && "text-text-light-gray opacity-70",
                    )}
                    key={eventName}
                  >
                    <input
                      checked={checked}
                      className="sr-only"
                      onChange={(event) =>
                        setEvents((current) =>
                          event.target.checked
                            ? [...current, eventName]
                            : current.filter((value) => value !== eventName),
                        )
                      }
                      type="checkbox"
                    />
                    {eventName}
                  </label>
                );
              })}
            </div>
            <span className="text-micro text-text-light-gray">
              {events.length === EVENTS.length
                ? "All six selected. Tap to switch one off."
                : `${events.length} of ${EVENTS.length} selected.`}
            </span>
          </fieldset>
          <button
            className="ml-2 inline-flex w-fit items-center gap-2 rounded-lg bg-active-modal-element px-4 py-2 font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:text-text-light-gray"
            disabled={busy === "create" || !teamId || !url.trim() || events.length === 0}
            type="submit"
          >
            {busy === "create" ? (
              <RefreshCw className="animate-spin" size={14} />
            ) : (
              <Send size={14} />
            )}
            {busy === "create" ? "Adding endpoint" : "Add endpoint"}
          </button>
        </form>
      </SettingsCard>
    </SettingsSectionShell>
  );
}
