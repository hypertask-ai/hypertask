"use client";

import { useState, type FormEvent } from "react";
import { addYears, endOfDay, format, parseISO } from "date-fns";
import { TEAM_COMP_PLANS, type TeamCompPlan } from "@/lib/teamComp";
import type { TeamCompView } from "@/lib/teamCompAdmin";

const ADMIN_COMP_ROUTE = "/api/admin/team-comp";
const INPUT_STYLE = "rounded-sm border border-border-light-gray-thin bg-comment-description px-3 py-2 text-content text-white-black";
const BUTTON_STYLE = "rounded-sm border border-border-light-gray-thin px-3 py-2 text-dense font-medium hover:bg-hover-active disabled:opacity-50";

export default function TeamCompAdmin() {
  const [query, setQuery] = useState("");
  const [teams, setTeams] = useState<TeamCompView[] | null>(null);
  const [team, setTeam] = useState<TeamCompView | null>(null);
  const [plan, setPlan] = useState<TeamCompPlan>("Pro");
  const [until, setUntil] = useState(() => format(addYears(new Date(), 1), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function selectTeam(next: TeamCompView) {
    setTeam(next);
    setPlan(next.compedPlan === "BYOK" ? "BYOK" : "Pro");
    setUntil(format(addYears(new Date(), 1), "yyyy-MM-dd"));
    setNotice(null);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setTeam(null);
    setTeams(null);
    try {
      const value = query.trim();
      const key = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? "teamId" : "query";
      const response = await fetch(`${ADMIN_COMP_ROUTE}?${new URLSearchParams({ [key]: value })}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not find teams");
      const matches: TeamCompView[] = body.comp ? [body.comp] : body.teams;
      setTeams(matches);
      if (matches.length === 1) selectTeam(matches[0]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not find teams");
    } finally {
      setBusy(false);
    }
  }

  async function update(clear: boolean) {
    if (!team) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(ADMIN_COMP_ROUTE, {
        method: clear ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clear
          ? { teamId: team.teamId }
          : { teamId: team.teamId, plan, until: endOfDay(parseISO(until)).toISOString() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update comp");
      setTeam(body.comp);
      setTeams((current) => current?.map((row) => row.teamId === body.comp.teamId ? body.comp : row) ?? null);
      setNotice(clear ? "Comp cleared. Stripe subscriptions are unchanged." : "Comp saved. Stripe subscriptions are unchanged.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update comp");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-pageBackground px-4 py-8 text-white-black sm:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-heading font-semibold">Team comps</h1>
        <p className="mt-2 text-content text-text-light-gray">
          Grant Pro or BYOK until an end date. This never changes Stripe subscriptions or charges.
        </p>
        <form onSubmit={search} className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-2 text-content">
            Team ID or name
            <input required minLength={2} maxLength={100} value={query} disabled={busy}
              onChange={(event) => setQuery(event.target.value)} className={INPUT_STYLE} />
          </label>
          <button type="submit" disabled={busy} className={BUTTON_STYLE}>{busy ? "Working…" : "Find team"}</button>
        </form>
        {teams && (
          <div className="mt-6 overflow-hidden rounded-[5px] border border-border-light-gray-thin bg-cardBackground">
            {teams.length === 0 && <p className="p-4 text-content text-text-light-gray">No teams found.</p>}
            {teams.map((row) => (
              <button key={row.teamId} type="button" disabled={busy} aria-pressed={team?.teamId === row.teamId}
                onClick={() => selectTeam(row)}
                className="flex w-full flex-col gap-1 border-b border-border-light-gray-thin p-4 text-left last:border-b-0 hover:bg-hover-active disabled:opacity-50">
                <span className="text-content font-medium">{row.title ?? "Untitled team"} · {row.currentPlan}</span>
                <code className="break-all text-dense text-text-light-gray">{row.teamId}</code>
              </button>
            ))}
            {teams.length === 20 && <p className="p-4 text-content text-text-light-gray">Showing the first 20 matches. Narrow the name or use a team ID.</p>}
          </div>
        )}
        {team && (
          <section className="mt-6 rounded-[5px] border border-border-light-gray-thin bg-cardBackground p-4">
            <h2 className="text-content font-medium">{team.title ?? "Untitled team"}</h2>
            <dl className="mt-3 text-content text-text-light-gray">
              <div><dt className="inline">Current plan: </dt><dd className="inline">{team.currentPlan}</dd></div>
              <div><dt className="inline">Comped plan: </dt><dd className="inline">{team.compedUntil ? team.compedPlan ?? "Pro" : "None"}</dd></div>
              <div><dt className="inline">Comped until: </dt><dd className="inline">{team.compedUntil ? new Date(team.compedUntil).toLocaleString() : "None"}</dd></div>
              <div><dt className="inline">Comp state: </dt><dd className="inline">{team.activeCompPlan ? "Active" : team.compedUntil ? "Expired" : "Not comped"}</dd></div>
            </dl>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void update(false); }}>
              <label className="flex flex-col gap-2 text-content">
                Comp plan
                <select value={plan} disabled={busy} onChange={(event) => setPlan(event.target.value as TeamCompPlan)} className={INPUT_STYLE}>
                  {TEAM_COMP_PLANS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-content">
                End date (required)
                <input type="date" required min={format(new Date(), "yyyy-MM-dd")} value={until} disabled={busy}
                  onChange={(event) => setUntil(event.target.value)} className={INPUT_STYLE} />
              </label>
              <button type="submit" disabled={busy} className={`${BUTTON_STYLE} bg-shadcn-primary text-primary-foreground`}>Set comp</button>
              <button type="button" disabled={busy || !team.compedUntil} onClick={() => void update(true)} className={BUTTON_STYLE}>Clear comp</button>
            </form>
          </section>
        )}
        {error && <p role="alert" className="mt-3 text-content text-destructive">{error}</p>}
        {notice && <p role="status" className="mt-3 text-content text-text-light-gray">{notice}</p>}
      </div>
    </main>
  );
}
