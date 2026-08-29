"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import type { IAgent } from "@/models/model";

const EVENTS = [
  "comment.mention",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "task.updated",
  "task.created",
] as const;

type Delivery = {
  id: string;
  event: string;
  status: string;
  attemptCount: number;
  statusCode: number | null;
  error: string | null;
  createdAt: string;
};

type Subscription = {
  id: string;
  projectId: number | null;
  url: string;
  events: string[];
  active: boolean;
  secretHint: string;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
};

const ACTION_CLASS =
  "inline-flex min-h-7 items-center gap-1.5 rounded-[4px] border-0 px-2 py-1 text-meta font-medium text-white-black transition-colors hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

export default function AgentWebhookPanel({ agent }: { agent: IAgent }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [active, setActive] = useState(true);
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/webhook`);
      const data = (await response.json()) as {
        success?: boolean;
        subscription?: Subscription | null;
        deliveries?: Delivery[];
        error?: string;
      };
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load webhook");
      const next = data.subscription ?? null;
      setSubscription(next);
      setDeliveries(data.deliveries ?? []);
      setUrl(next?.url ?? "");
      setProjectId(next?.projectId == null ? "" : String(next.projectId));
      setActive(next?.active ?? true);
      setEvents(next?.events?.length ? next.events : [...EVENTS]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load webhook");
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (rotateSecret = false) => {
    if (!url.trim()) return toast.error("Enter an HTTPS endpoint");
    if (events.length === 0) return toast.error("Select at least one event");
    setSaving(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/webhook`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          projectId: projectId ? Number(projectId) : null,
          active,
          events,
          rotateSecret,
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        subscription?: Subscription;
        secret?: string;
        error?: string;
      };
      if (!response.ok || !data.success || !data.subscription) {
        throw new Error(data.error ?? "Could not save webhook");
      }
      setSubscription(data.subscription);
      setRevealedSecret(data.secret ?? null);
      toast.success(rotateSecret ? "Webhook secret rotated" : "Webhook saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save webhook");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this webhook and its delivery history?")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/webhook`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete webhook");
      setSubscription(null);
      setDeliveries([]);
      setRevealedSecret(null);
      toast.success("Webhook deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete webhook");
    } finally {
      setSaving(false);
    }
  };

  const replay = async (deliveryId: string) => {
    try {
      const response = await fetch(`/api/agents/${agent.id}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replay", deliveryId }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not replay delivery");
      toast.success("Delivery queued again");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not replay delivery");
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not send test delivery");
      }
      toast.success("Signed test delivery queued");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send test delivery");
    } finally {
      setTesting(false);
    }
  };

  const hasUnsavedChanges = Boolean(
    subscription &&
      (url.trim() !== subscription.url ||
        (projectId ? Number(projectId) : null) !== subscription.projectId ||
        active !== subscription.active ||
        events.length !== subscription.events.length ||
        events.some((event) => !subscription.events.includes(event))),
  );

  if (loading) {
    return <p className="px-3 pb-3 text-meta text-text-light-gray">Loading webhook settings…</p>;
  }

  return (
    <div className="space-y-4 border-t border-border-color px-3 pb-3 pt-4 text-content">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-active-modal-element text-primary">
          <Send className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white-black">Wake this agent without polling</p>
          <p className="mt-0.5 max-w-[64ch] text-meta text-text-light-gray">
            Add an HTTPS receiver, save its one-time secret, then send a signed test delivery.
          </p>
        </div>
      </div>

      <ol className="grid grid-cols-1 gap-1.5 text-meta text-text-light-gray sm:grid-cols-3">
        <li><strong className="font-medium text-white-black">1.</strong> Add endpoint</li>
        <li><strong className="font-medium text-white-black">2.</strong> Save secret</li>
        <li><strong className="font-medium text-white-black">3.</strong> Verify test</li>
      </ol>

      <label className="block space-y-1">
        <span className="text-meta font-medium text-white-black">HTTPS endpoint</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://agent.example.com/hypertask"
          autoComplete="url"
          className="h-8 w-full rounded-[4px] border border-border-color bg-active-modal-element px-2.5 text-meta text-white-black outline-none placeholder:text-text-light-gray focus:border-primary"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-meta font-medium text-white-black">Board scope</span>
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-8 w-full rounded-[4px] border border-border-color bg-active-modal-element px-2 text-meta text-white-black outline-none focus:border-primary"
        >
          <option value="">All boards this agent belongs to</option>
          {(agent.boards ?? []).map((board) => (
            <option key={board.id} value={board.id}>{board.name}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1.5 text-meta font-medium text-white-black">Events</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {EVENTS.map((eventName) => (
            <label key={eventName} className="flex items-center gap-1.5 text-meta text-white-black">
              <input
                type="checkbox"
                checked={events.includes(eventName)}
                onChange={(event) =>
                  setEvents((current) =>
                    event.target.checked
                      ? [...current, eventName]
                      : current.filter((value) => value !== eventName),
                  )
                }
              />
              <code>{eventName}</code>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-1.5 text-meta text-white-black">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Delivery enabled
      </label>

      {revealedSecret && (
        <div className="rounded-[6px] bg-active-modal-element p-2.5" role="status">
          <p className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-white-black">
            <ShieldCheck className="h-3.5 w-3.5 text-green-500" aria-hidden />
            Save this signing secret now
          </p>
          <div className="flex items-center justify-between gap-2">
            <code className="min-w-0 break-all text-meta text-white-black">{revealedSecret}</code>
            <button
              type="button"
              className={ACTION_CLASS}
              onClick={() => navigator.clipboard.writeText(revealedSecret)}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
          <p className="mt-1 text-[10px] text-text-light-gray">It is shown once and cannot be recovered later.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={ACTION_CLASS} disabled={saving} onClick={() => void save(false)}>
          <RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} />
          {saving ? "Saving…" : "Save webhook"}
        </button>
        {subscription && (
          <>
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={saving || testing || hasUnsavedChanges || !active}
              title={hasUnsavedChanges ? "Save changes before testing" : undefined}
              onClick={() => void sendTest()}
            >
              <Send className={`h-3.5 w-3.5 ${testing ? "animate-pulse" : ""}`} />
              {testing ? "Queuing test…" : "Send test"}
            </button>
            <button type="button" className={ACTION_CLASS} disabled={saving} onClick={() => void save(true)}>
              <RotateCw className="h-3.5 w-3.5" /> Rotate secret
            </button>
            <button type="button" className={ACTION_CLASS} disabled={saving} onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </>
        )}
      </div>

      <details className="rounded-[6px] bg-active-modal-element px-2.5 py-2 text-meta text-text-light-gray">
        <summary className="cursor-pointer select-none font-medium text-white-black">
          Verify signatures and process deliveries
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Compute HMAC-SHA256 over <code>timestamp.rawBody</code>, compare it with
            <code> X-Hypertask-Signature</code>, and deduplicate with
            <code> X-Hypertask-Delivery</code>.
          </p>
          <pre className="overflow-x-auto rounded-[4px] bg-background p-2 text-[10px] text-white-black"><code>{`const expected = "sha256=" + createHmac("sha256", secret)
  .update(timestamp + "." + rawBody)
  .digest("hex");`}</code></pre>
          <a
            href="https://docs.hypertask.ai/mcp/agent-webhooks/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Setup guide and receiver examples
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </details>

      {subscription && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-light-gray">
              Recent deliveries
            </p>
            <span className="text-[10px] text-text-light-gray">{subscription.secretHint}</span>
          </div>
          {deliveries.length === 0 ? (
            <div className="flex items-start gap-2 py-1 text-meta text-text-light-gray">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                No deliveries yet. Save the endpoint, then use <strong className="font-medium text-white-black">Send test</strong> to verify the full path.
              </p>
            </div>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {deliveries.map((delivery) => (
                <li key={delivery.id} className="flex items-center gap-2 rounded-[4px] bg-active-modal-element px-2 py-1.5 text-meta">
                  <span className="min-w-0 flex-1 truncate text-white-black">
                    {delivery.event} · {delivery.status}
                    {delivery.statusCode ? ` · ${delivery.statusCode}` : ""}
                    {delivery.attemptCount ? ` · ${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}` : ""}
                  </span>
                  {delivery.error && (
                    <span className="sr-only">Error: {delivery.error}</span>
                  )}
                  <button type="button" className={ACTION_CLASS} onClick={() => void replay(delivery.id)}>
                    Replay
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
