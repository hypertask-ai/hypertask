"use client";

import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { activeSearchValue, candidateQuery, chipQuery, splitSearchChips } from "@/lib/search/chips";
import { operatorMatches, parseSearchTokens, SEARCH_OPERATORS, type Names, type SearchToken } from "@/lib/search/operators";
import { localValueSuggestions, operatorSuggestions, searchCompletion, searchFilterColour, SEARCH_TIPS } from "@/lib/search/autocomplete";
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
  autocompleteEnabled?: boolean;
};

export default function SearchChipsInput({ value, onChange, onRun, boardId, inputRef, autocompleteEnabled = false }: Props) {
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
  const pickerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const { chips, text } = splitSearchChips(value, editing, names, autocompleteEnabled);
  const completion = autocompleteEnabled ? searchCompletion(text, names) : null;
  const active = autocompleteEnabled ? completion : activeSearchValue(text, names);
  const tips = autocompleteEnabled && focused && !value.trim();
  const picker = dismissed ? null : active;
  const localRows = completion?.kind === 'operator'
    ? operatorSuggestions(completion.value).map((operator) => ({ id: operator, name: `${operator}:` }))
    : completion ? localValueSuggestions(completion.operator, completion.value) : null;
  const rows = tips ? SEARCH_OPERATORS.map((operator) => ({ id: operator, name: `${SEARCH_TIPS[operator].example} — ${SEARCH_TIPS[operator].meaning}` })) : localRows ?? candidates;
  const open = !dismissed && Boolean(picker || tips);
  const listId = "search-chip-options";
  const selectedRow = rows[selectedIndex] ?? rows[0];
  const ghost = open && completion?.kind === 'operator' && caretAtEnd && selectedRow
    ? String(selectedRow.id).slice(completion.value.length) + ':' : '';

  useEffect(() => {
    if (autocompleteEnabled && open) pickerRef.current?.querySelector<HTMLElement>(`#mention-button-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [autocompleteEnabled, open, selectedIndex]);

  useEffect(() => {
    setEditing(false);
    setDismissed(false);
  }, [boardId]);

  useEffect(() => {
    if (!picker || (autocompleteEnabled && (completion?.kind === 'operator' || localRows !== null))) {
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
  }, [picker?.operator, picker?.value, dismissed, boardId, autocompleteEnabled]);

  useEffect(() => {
    if (editing) return;
    const tokens = parseSearchTokens(value, names);
    const unresolved = tokens.filter((token) =>
      ['from', 'assignee', 'in', 'board', 'label'].includes(token.operator) &&
      !token.raw.includes('"') && !names[token.operator as keyof Names]?.includes(token.value.replace(/^[@#]/, '')));
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
    // Clearing the draft must not reactivate the last committed chip.
    setEditing(!autocompleteEnabled || Boolean(event.target.value.trim()));
    setDismissed(false);
    setSelectedIndex(0);
    setCaretAtEnd(event.target.selectionStart === event.target.value.length);
    onChange(chipQuery(chips, event.target.value) + (/\s$/.test(event.target.value) ? ' ' : ''));
  }

  function reopenPicker(event: React.SyntheticEvent<HTMLInputElement>) {
    const caret = event.currentTarget.selectionStart;
    setCaretAtEnd(caret === text.length);
    if (autocompleteEnabled && !value.trim()) { setDismissed(false); setSelectedIndex(0); }
    if (autocompleteEnabled && completion?.kind === 'operator' && caret === text.length) setDismissed(false);
    const atCaret = caret === null ? null : autocompleteEnabled ? searchCompletion(text.slice(0, caret), names) : activeSearchValue(text.slice(0, caret), names);
    if (active && caret !== null && caret <= (active.end ?? text.length) && atCaret?.start === active.start) setDismissed(false);
  }

  function chipText(chip: SearchToken) {
    const name = chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value;
    const marker = chip.operator === 'from' || chip.operator === 'assignee' ? '@' : chip.operator === 'in' || chip.operator === 'board' ? '#' : '';
    return `${chip.negated ? '-' : ''}${chip.operator}:${marker}${marker && name.startsWith(marker) ? name.slice(1) : name}`;
  }

  function choose(row: Candidate) {
    if (autocompleteEnabled && (tips || completion?.kind === 'operator')) {
      const nextText = tips ? `${row.id}:` : text.slice(0, completion?.start) + `${completion?.negated ? '-' : ''}${row.id}:` + text.slice(completion?.end);
      setEditing(true);
      setDismissed(false);
      setSelectedIndex(0);
      setCaretAtEnd(true);
      onChange(chipQuery(chips, nextText));
      inputRef.current?.focus();
      return;
    }
    if (!active) return;
    const before = text.slice(0, active.start).trim();
    const after = text.slice(active.end ?? text.length).trim();
    const selected = `${active.negated ? '-' : ''}${candidateQuery(active.operator, row.name, row.id)}`;
    setChipLabels((previous) => ({ ...previous, [`${active.operator}:${row.id}`]: row.name }));
    if (localRows === null) setNames((previous) => ({ ...previous, [active.operator]: [...(previous[active.operator as keyof Names] ?? []), String(row.id)] }));
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
    if (autocompleteEnabled && (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey)) return;
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      return;
    }
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (open && rows.length && (event.key === "Enter" || (event.key === "Tab" && (!autocompleteEnabled || !event.shiftKey)))) {
      event.preventDefault();
      event.stopPropagation();
      choose(selectedRow);
      return;
    }
    if (event.key === "Backspace" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0 && chips.length) {
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

  const summary = [...chips.map(chipText), text.trim()].filter(Boolean).join(' ');
  return (
    <div className="relative w-full px-4 @md:px-9">
      <div className="flex min-h-10 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {chips.map((chip: SearchToken, index: number) => (
          <button
            key={`${chip.start}-${index}`}
            type="button"
            onClick={(event) => { event.stopPropagation(); remove(index); }}
            aria-label={`Remove ${chip.operator}:${chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value} filter`}
            className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-content ${autocompleteEnabled ? `text-white-black border-l-2 ${searchFilterColour(chip.operator)}` : 'text-mention-highlight'}`}
            style={autocompleteEnabled ? undefined : { backgroundColor: "color-mix(in srgb, var(--color-mention-highlight) 12%, var(--bg-mention))" }}
          >
            {chip.operator === 'from' || chip.operator === 'assignee' ? <UserRound size={14} aria-hidden="true" /> : (chip.operator === 'in' || chip.operator === 'board') ? <Hash size={14} aria-hidden="true" /> : null}
            <span>{chipText(chip)}</span>
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ))}
        <div className="relative min-w-[8rem] flex-1 text-subheading font-medium">
          {autocompleteEnabled && (completion || ghost) && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre">
              <span className="invisible">{text.slice(0, completion?.start)}</span>
              <span className="relative">
                <span className="invisible">{text.slice(completion?.start, completion?.end)}</span>
                {completion?.kind === 'value' && <span data-search-filter-frame className={`absolute inset-0 rounded-sm border ${searchFilterColour(completion.operator)}`} />}
              </span>
              <span className="invisible">{text.slice(completion?.end)}</span>
              <span data-search-ghost className="text-icon-hover-gray">{ghost}</span>
            </div>
          )}
        <input
          id={searchConfig.elementIds.input.id}
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={chips.length ? "" : searchConfig.elementIds.input.placeholder}
          className="relative w-full bg-transparent text-subheading font-medium text-white-black outline-none [&::-webkit-search-cancel-button]:appearance-none"
          value={text}
          onChange={change}
          onKeyDown={keyDown}
          onFocus={(event) => { setFocused(true); reopenPicker(event); }}
          onClick={reopenPicker}
          onSelect={(event) => setCaretAtEnd(event.currentTarget.selectionStart === text.length)}
          onBlur={(event) => { if (!pickerRef.current?.contains(event.relatedTarget)) { setDismissed(true); setFocused(false); } }}
          role="combobox"
          aria-label="Search tasks"
          aria-autocomplete={autocompleteEnabled ? "both" : "list"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && rows.length ? `mention-button-${Math.min(selectedIndex, rows.length - 1)}` : undefined}
        />
        </div>
      </div>
      {open && (
        <div ref={pickerRef} className="absolute left-4 top-full z-30 max-w-[calc(100%-2rem)] @md:left-9" onMouseDown={(event) => event.preventDefault()}>
          {autocompleteEnabled && <div className="rounded-t-sm bg-modalBackground px-3 pt-2 text-meta text-text-light-gray">{tips ? 'Search tips' : 'Suggestions'} · ↑ ↓ to move · Tab / Enter to accept · Esc to close</div>}
          {error && localRows === null && !tips ? <div id={listId} role="alert" className="rounded bg-modalBackground p-3 text-white-black">Could not load suggestions. Keep typing to retry.</div> : (
            <MentionListRows
              id={listId}
              loadingLabel="Loading suggestions..."
              className={autocompleteEnabled ? "max-w-full" : undefined}
              isLoading={localRows === null && !tips && loading}
              hasItems={rows.length > 0}
              noResults={!rows.length}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
              ignoreItems={[]}
              items={rows.map((row, index) => ({ id: typeof row.id === 'number' ? row.id : index, name: row.name, type: (picker?.operator === 'in' || picker?.operator === 'board') ? 'project' as const : 'name' as const, identifier: '' }))}
              selectItem={(index) => choose(rows[index])}
            />
          )}
        </div>
      )}
      {!picker && hydrationStatus && <div role={hydrationStatus === 'error' ? 'alert' : 'status'} className="mt-2 text-content text-text-light-gray">{hydrationStatus === 'error' ? 'Could not rebuild search filters. Reload to retry.' : 'Loading search filters...'}</div>}
      {summary && <button type="button" className="mt-2 block text-left text-content text-white-black hover:bg-active-elementBg" onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }} onClick={() => onRun(value)}>Show results for: {summary}</button>}
    </div>
  );
}
