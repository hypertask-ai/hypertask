"use client";

import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { activeSearchValue, candidateQuery, chipQuery, splitSearchChips } from "@/lib/search/chips";
import { operatorMatches, parseSearchTokens, type Names, type SearchToken } from "@/lib/search/operators";
import { searchConfig } from "@/lib/configs/search.config";
import { Hash, UserRound, X } from "lucide-react";
import React, { type ChangeEvent, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

type Candidate = { id: number | string; name: string };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  boardId: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
};

export default function SearchChipsInput({ value, onChange, onRun, boardId, inputRef }: Props) {
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Names>({});
  const [chipLabels, setChipLabels] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hydrationStatus, setHydrationStatus] = useState<'loading' | 'error' | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lookup = useRef(0);
  const { chips, text } = splitSearchChips(value, editing, names);
  const active = activeSearchValue(text, names);
  const picker = dismissed ? null : active;
  const listId = "search-chip-options";

  useEffect(() => {
    setEditing(false);
    setDismissed(false);
  }, [boardId]);

  useEffect(() => {
    if (!picker) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const request = ++lookup.current;
    setLoading(true);
    setError(false);
    setCandidates([]);
    setSelectedIndex(0);
    const params = new URLSearchParams({ operator: picker.operator, value: picker.value });
    if (boardId) params.set("boardId", String(boardId));
    const timer = setTimeout(() => fetch(`/api/search/values?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Value lookup failed");
        return response.json() as Promise<{ candidates: Candidate[] }>;
      })
      .then(({ candidates: rows }) => {
        if (request !== lookup.current) return;
        setCandidates(rows);
        if (['from', 'assignee', 'in', 'board', 'label'].includes(picker.operator)) {
          const key = picker.operator as keyof Names;
          setNames((previous) => ({ ...previous, [key]: [...new Set([...(previous[key] ?? []), ...rows.map((row) => row.name)])] }));
        }
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted || request !== lookup.current) return;
        setError(true);
        setLoading(false);
      }), 180);
    return () => { clearTimeout(timer); controller.abort(); ++lookup.current; };
  }, [picker?.operator, picker?.value, dismissed, boardId]);

  useEffect(() => {
    if (editing) return;
    const tokens = parseSearchTokens(value);
    const unresolved = tokens.filter((token) =>
      ['from', 'assignee', 'in', 'board', 'label'].includes(token.operator) &&
      !token.raw.includes('"') && value.slice(token.end).trim());
    if (!unresolved.length) { setHydrationStatus(null); return; }
    const controller = new AbortController();
    setHydrationStatus('loading');
    const matches = operatorMatches(value);
    Promise.all(unresolved.map(async (token) => {
      const matchIndex = matches.findIndex((match) => match.start === token.start);
      const tail = value.slice(matches[matchIndex].valueStart, matches[matchIndex + 1]?.start ?? value.length).trim();
      const params = new URLSearchParams({ operator: token.operator, value: token.value.replace(/^[@#]/, ''), resolve: tail });
      if (boardId) params.set('boardId', String(boardId));
      const response = await fetch(`/api/search/values?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Value lookup failed');
      const result = await response.json() as { candidates: Candidate[]; resolved?: string; resolvedId?: string };
      return { operator: token.operator, value: token.value, resolvedId: result.resolvedId, names: result.resolved ? [result.resolved] : [] };
    })).then((results) => {
      if (controller.signal.aborted) return;
      setNames((previous) => {
        const next = { ...previous };
        for (const { operator, value, resolvedId, names } of results) {
          const key = operator as keyof Names;
          next[key] = [...(next[key] ?? []), ...names, ...(names.length && (/^\d+$/.test(value) || resolvedId === value) ? [value] : [])];
        }
        return next;
      });
      setChipLabels((previous) => Object.assign({}, ...results.filter(({ names }) => names.length).map(({ operator, value, names }) => ({ [`${operator}:${value}`]: names[0] })), previous));
      setHydrationStatus(null);
    }).catch(() => { if (!controller.signal.aborted) setHydrationStatus('error'); });
    return () => controller.abort();
  }, [value, editing, boardId]);

  function change(event: ChangeEvent<HTMLInputElement>) {
    setEditing(true);
    setDismissed(false);
    onChange(chipQuery(chips, event.target.value) + (/\s$/.test(event.target.value) ? ' ' : ''));
  }

  function choose(row: Candidate) {
    if (!active) return;
    const before = text.slice(0, active.start).trim();
    const after = text.slice(active.end ?? text.length).trim();
    const selected = candidateQuery(active.operator, row.name, row.id);
    setChipLabels((previous) => ({ ...previous, [`${active.operator}:${row.id}`]: row.name }));
    setNames((previous) => ({ ...previous, [active.operator]: [...(previous[active.operator as keyof Names] ?? []), String(row.id)] }));
    const next = chipQuery(chips, [before, selected, after].filter(Boolean).join(' '));
    setEditing(false);
    setDismissed(true);
    setCandidates([]);
    onChange(next);
    onRun(next);
    inputRef.current?.focus();
  }

  function remove(index: number) {
    const next = chipQuery(chips.filter((_, i) => i !== index), text);
    onChange(next);
    onRun(next);
    inputRef.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (picker && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      return;
    }
    if (picker && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex((current) => Math.max(0, Math.min(candidates.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (picker && candidates.length && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      event.stopPropagation();
      choose(candidates[selectedIndex] ?? candidates[0]);
      return;
    }
    if (event.key === "Backspace" && event.currentTarget.selectionStart === 0 && chips.length) {
      event.preventDefault();
      event.stopPropagation();
      remove(chips.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      onRun(value);
    }
  }

  const summary = [...chips.map((chip) => `${chip.negated ? '-' : ''}${chip.operator}:${chip.value}`), text.trim()].filter(Boolean).join(' ');
  return (
    <div className="relative w-full px-4 @md:px-9">
      <div className="flex min-h-10 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {chips.map((chip: SearchToken, index: number) => (
          <button
            key={`${chip.start}-${index}`}
            type="button"
            onClick={(event) => { event.stopPropagation(); remove(index); }}
            aria-label={`Remove ${chip.operator}:${chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value} filter`}
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-mention-highlight text-content"
            style={{ backgroundColor: "color-mix(in srgb, var(--color-mention-highlight) 12%, var(--bg-mention))" }}
          >
            {chip.operator === 'from' || chip.operator === 'assignee' ? <UserRound size={14} aria-hidden="true" /> : (chip.operator === 'in' || chip.operator === 'board') ? <Hash size={14} aria-hidden="true" /> : null}
            <span>{chip.negated ? '-' : ''}{chip.operator}:{chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value}</span>
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ))}
        <input
          id={searchConfig.elementIds.input.id}
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={chips.length ? "" : searchConfig.elementIds.input.placeholder}
          className="min-w-[8rem] flex-1 bg-transparent text-subheading font-medium text-white-black outline-none [&::-webkit-search-cancel-button]:appearance-none"
          value={text}
          onChange={change}
          onKeyDown={keyDown}
          role="combobox"
          aria-label="Search tasks"
          aria-autocomplete="list"
          aria-expanded={Boolean(picker)}
          aria-controls={picker ? listId : undefined}
          aria-activedescendant={picker && candidates.length ? `mention-button-${selectedIndex}` : undefined}
        />
      </div>
      {picker && (
        <div className="absolute left-4 top-full z-30 @md:left-9" onMouseDown={(event) => event.preventDefault()}>
          {error ? <div id={listId} role="alert" className="rounded bg-modalBackground p-3 text-white-black">Could not load suggestions. Keep typing to retry.</div> : (
            <MentionListRows
              id={listId}
              loadingLabel="Loading suggestions..."
              isLoading={loading}
              hasItems={candidates.length > 0}
              noResults={!candidates.length}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
              ignoreItems={[]}
              items={candidates.map((row, index) => ({ id: typeof row.id === 'number' ? row.id : index, name: row.name, type: (picker.operator === 'in' || picker.operator === 'board') ? 'project' as const : 'name' as const, identifier: '' }))}
              selectItem={(index) => choose(candidates[index])}
            />
          )}
        </div>
      )}
      {!picker && hydrationStatus && <div role={hydrationStatus === 'error' ? 'alert' : 'status'} className="mt-2 text-content text-text-light-gray">{hydrationStatus === 'error' ? 'Could not rebuild search filters. Reload to retry.' : 'Loading search filters...'}</div>}
      {summary && <button type="button" className="mt-2 block text-left text-content text-white-black hover:bg-active-elementBg" onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }} onClick={() => onRun(value)}>Show results for: {summary}</button>}
    </div>
  );
}
