"use client";

import UserAvatar from "@/components/Common/UserAvatar";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6865_SEARCH_LAYOUT_FLAG, HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG, HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, HTPR_6879_SEARCH_ESC_BACK_FLAG, HTPR_6880_SEARCH_COMMENTER_FLAG } from "@/lib/flags/keys";
import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { activeSearchValue, candidateQuery, chipQuery, searchChipText, splitSearchChips } from "@/lib/search/chips";
import { operatorMatches, parseSearchTokens, SEARCH_OPERATORS, type Names, type SearchOperator, type SearchToken } from "@/lib/search/operators";
import { localValueSuggestions, operatorSuggestions, searchCompletion, searchFilterColour, highlightedTitle, SEARCH_TIPS, type SearchCandidate } from "@/lib/search/autocomplete";
import { searchConfig } from "@/lib/configs/search.config";
import { Hash, UserRound, X } from "lucide-react";
import React, { type ChangeEvent, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

type Candidate = SearchCandidate & { count?: number; byName?: boolean; query?: string; operator?: SearchOperator; kind?: "ai" | "operator" | "value" | "recent" };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  boardId: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  autocompleteEnabled?: boolean;
  recentSearches?: string[];
  layoutEnabled?: boolean;
  availableBoards?: { id: number; title?: string }[];
  onAskAi?: (readableQuery?: string) => void;
  showSuggestions?: boolean;
};

export default function SearchChipsInput({ value, onChange, onRun, boardId, inputRef, autocompleteEnabled = false, recentSearches = [], layoutEnabled: layoutRequested = false, availableBoards = [], onAskAi, showSuggestions = true }: Props) {
  const layoutFlagEnabled = useFlag(HTPR_6865_SEARCH_LAYOUT_FLAG);
  const rowHighlightEnabled = useFlag(HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG);
  const layoutEnabled = layoutFlagEnabled && layoutRequested && autocompleteEnabled;
  const labelScopeFlagEnabled = useFlag(HTPR_6878_SEARCH_LABEL_SCOPE_FLAG);
  const labelScopeEnabled = labelScopeFlagEnabled && layoutEnabled;
  const searchEscBackFlagEnabled = useFlag(HTPR_6879_SEARCH_ESC_BACK_FLAG);
  const searchEscBackEnabled = searchEscBackFlagEnabled && layoutEnabled;
  const commenterFlagEnabled = useFlag(HTPR_6880_SEARCH_COMMENTER_FLAG);
  const commenterEnabled = commenterFlagEnabled && layoutEnabled;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const queryNames = labelScopeEnabled ? { ...names,
    in: [...(names.in ?? []), ...availableBoards.map((board) => board.title ?? '')],
    board: [...(names.board ?? []), ...availableBoards.map((board) => board.title ?? '')],
  } : names;
  const { chips, text } = splitSearchChips(value, editing, queryNames, autocompleteEnabled, commenterFlagEnabled && layoutEnabled);
  const pickedBoards = labelScopeEnabled ? [...new Set(parseSearchTokens(value, queryNames)
    .filter((token) => !token.negated && (token.operator === 'in' || token.operator === 'board'))
    .flatMap((token) => {
      const name = token.value.replace(/^#/, '').trim();
      return /^\d+$/.test(name) ? [Number(name)] : availableBoards
        .filter((board) => board.title?.toLowerCase() === name.toLowerCase()).map((board) => board.id);
    }))].join(',') : '';
  const summary = [...chips.map(chipText), text.trim()].filter(Boolean).join(' ');
  const completion = autocompleteEnabled ? searchCompletion(text, names, commenterEnabled) : null;
  const active = autocompleteEnabled ? completion : activeSearchValue(text, names, commenterEnabled);
  const tips = autocompleteEnabled && (focused || searchEscBackEnabled) && !value.trim();
  const picker = dismissed ? null : active;
  const localRows = completion?.kind === 'operator'
    ? operatorSuggestions(completion.value, commenterEnabled).map((operator) => ({ id: operator, name: `${operator}:` }))
    : completion ? localValueSuggestions(completion.operator, completion.value) : null;
  const genericPrefix = layoutEnabled && !dismissed && showSuggestions && completion?.kind !== 'value' &&
    (text.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 0 ? text.match(/(?:^|\s)([a-z]+)$/i) : null;
  const lookupValue = genericPrefix?.[1] ?? picker?.value;
  const rows: Candidate[] = tips ? [
    ...(layoutEnabled ? [...new Set(recentSearches)] : recentSearches).map((query, index) => ({ id: `recent-${index}`, name: layoutEnabled ? query : `Recent: ${query}`, query, kind: 'recent' as const })),
    ...SEARCH_OPERATORS.filter((operator) => operator !== 'commenter' || (commenterFlagEnabled && layoutEnabled)).map((operator) => ({ id: operator, name: `${SEARCH_TIPS[operator].example} - ${SEARCH_TIPS[operator].meaning}`, operator, kind: 'operator' as const })),
  ] : layoutEnabled ? [
    ...(value.trim() ? [{ id: 'ask-ai', name: labelScopeEnabled ? summary : value.trim(), kind: 'ai' as const }] : []),
    ...(localRows ?? []).map((row) => ({ ...row, kind: completion?.kind === 'operator' ? 'operator' as const : 'value' as const })),
    ...((localRows === null || genericPrefix) ? candidates.map((row) => ({ ...row, kind: 'value' as const })) : []),
  ] : localRows ?? candidates;
  const open = (searchEscBackEnabled && tips) || (!dismissed && (layoutEnabled ? focused && showSuggestions && Boolean(value.trim() || tips) : Boolean(picker || tips)));
  const openRef = useRef(open);
  openRef.current = open;
  const listId = "search-chip-options";
  const selectedRow = rows[selectedIndex] ?? rows[layoutEnabled && !tips ? 1 : 0] ?? rows[0];
  const ghost = open && caretAtEnd && selectedRow && completion?.kind === 'operator' && (!layoutEnabled || selectedRow.kind === 'operator')
    ? String(selectedRow.id).slice(completion.value.length) + ':'
    : open && layoutEnabled && caretAtEnd && completion?.kind === 'value' && selectedRow?.kind === 'value' &&
      ['from', 'commenter', 'assignee', 'in', 'board', 'label'].includes(completion.operator) && completion.value &&
      /^-?(from|commenter|assignee|in|board|label):/i.test(text.slice(completion.start)) && !text.endsWith('"') &&
      selectedRow.name.toLowerCase().startsWith(completion.value.toLowerCase())
      ? selectedRow.name.slice(completion.value.length) : '';

  useEffect(() => {
    if (autocompleteEnabled && open) pickerRef.current?.querySelector<HTMLElement>(`#mention-button-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [autocompleteEnabled, open, selectedIndex]);

  useEffect(() => {
    if (!layoutEnabled) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setDismissed(true);
        setFocused(false);
      }
    };
    // The list stays open when focus leaves, so Escape must still close it from anywhere.
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || document.activeElement === inputRef.current || !openRef.current) return;
      // Handled here: stop the search page's Escape-back from also clearing the query.
      event.preventDefault();
      setDismissed(true);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [layoutEnabled]);

  useEffect(() => {
    setEditing(false);
    setDismissed(false);
  }, [boardId]);

  useEffect(() => {
    if (searchEscBackEnabled && !showSuggestions) setEditing(false);
  }, [searchEscBackEnabled, showSuggestions, value]);

  useEffect(() => {
    if (!(genericPrefix || picker) || (!genericPrefix && autocompleteEnabled && (completion?.kind === 'operator' || localRows !== null))) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const request = ++lookup.current;
    setLoading(true);
    setError(false);
    setCandidates([]);
    setSelectedIndex(layoutEnabled ? 1 : 0);
    const operators = genericPrefix ? ['from', 'label', 'in'] as const : [picker!.operator as SearchOperator];
    const timer = setTimeout(() => Promise.all(operators.map(async (operator) => {
      const params = new URLSearchParams({ operator, value: lookupValue ?? '' });
      if (boardId) params.set("boardId", String(boardId));
      if (labelScopeEnabled && operator === 'label' && pickedBoards) params.set('boards', pickedBoards);
      const response = await fetch(`/api/search/values?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Value lookup failed");
      const result = await response.json() as { candidates: Candidate[] };
      return result.candidates.map((row) => ({ ...row, operator }));
    })).then((results) => results.flat())
      .then((rows) => {
        if (request !== lookup.current) return;
        setCandidates(rows);
        setNames((previous) => {
          const next = { ...previous };
          for (const operator of operators) {
            const key = operator as keyof Names;
            next[key] = [...new Set([...(previous[key] ?? []), ...rows.filter((row) => row.operator === operator).map((row) => row.name)])];
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted || request !== lookup.current) return;
        setError(true);
        setLoading(false);
      }), 180);
    return () => { clearTimeout(timer); controller.abort(); ++lookup.current; };
  }, [picker?.operator, picker?.value, dismissed, boardId, autocompleteEnabled, layoutEnabled, genericPrefix?.[1], labelScopeEnabled, pickedBoards, commenterEnabled]);

  useEffect(() => {
    if (editing) return;
    const queries = layoutEnabled && !value.trim() ? [value, ...new Set(recentSearches)] : [value];
    const tokens = queries.flatMap((query) => parseSearchTokens(query, names, commenterEnabled).map((token) => ({ ...token, query })));
    const unresolved = tokens.filter((token) =>
      ['from', 'commenter', 'assignee', 'in', 'board', 'label'].includes(token.operator) &&
      !token.raw.includes('"') && !names[token.operator as keyof Names]?.includes(token.value.replace(/^[@#]/, '')));
    if (!unresolved.length) { setHydrationStatus(null); return; }
    const controller = new AbortController();
    setHydrationStatus('loading');
    Promise.all(unresolved.map(async (token) => {
      const matches = operatorMatches(token.query);
      const matchIndex = matches.findIndex((match) => match.start === token.start);
      const tail = token.query.slice(matches[matchIndex].valueStart, matches[matchIndex + 1]?.start ?? token.query.length).trim();
      const params = new URLSearchParams({ operator: token.operator, value: token.value.replace(/^[@#]/, ''), resolve: tail });
      if (boardId) params.set('boardId', String(boardId));
      if (labelScopeEnabled && token.operator === 'label' && pickedBoards) params.set('boards', pickedBoards);
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
  }, [value, editing, boardId, layoutEnabled, layoutEnabled ? recentSearches.join('\n') : '', labelScopeEnabled, pickedBoards, commenterEnabled]);

  function change(event: ChangeEvent<HTMLInputElement>) {
    // Clearing the draft must not reactivate the last committed chip.
    setEditing(!autocompleteEnabled || Boolean(event.target.value.trim()));
    setDismissed(false);
    setSelectedIndex(layoutEnabled && event.target.value.trim() ? 1 : 0);
    setCaretAtEnd(event.target.selectionStart === event.target.value.length);
    onChange(chipQuery(chips, event.target.value) + (/\s$/.test(event.target.value) ? ' ' : ''));
  }

  function reopenPicker(event: React.SyntheticEvent<HTMLInputElement>) {
    const caret = event.currentTarget.selectionStart;
    setCaretAtEnd(caret === text.length);
    if (autocompleteEnabled && !value.trim()) { setDismissed(false); setSelectedIndex(0); }
    if (layoutEnabled && showSuggestions && value.trim()) { setDismissed(false); setSelectedIndex(1); }
    if (autocompleteEnabled && completion?.kind === 'operator' && caret === text.length) setDismissed(false);
    const atCaret = caret === null ? null : autocompleteEnabled ? searchCompletion(text.slice(0, caret), names, commenterEnabled) : activeSearchValue(text.slice(0, caret), names, commenterEnabled);
    if (active && caret !== null && caret <= (active.end ?? text.length) && atCaret?.start === active.start) setDismissed(false);
  }

  function chipText(chip: SearchToken) {
    const name = chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value;
    return searchChipText(chip, name, searchEscBackEnabled);
  }

  function choose(row: Candidate) {
    if (layoutEnabled && row.kind === 'ai') {
      setDismissed(true);
      if (labelScopeEnabled) onAskAi?.(summary);
      else onAskAi?.();
      return;
    }
    if (tips && row.query !== undefined) {
      setEditing(false);
      setDismissed(true);
      onChange(row.query);
      onRun(row.query);
      inputRef.current?.focus();
      return;
    }
    if (autocompleteEnabled && (tips || (completion?.kind === 'operator' && (!layoutEnabled || row.kind === 'operator')))) {
      const nextText = tips ? `${row.id}:` : text.slice(0, completion?.start) + `${completion?.negated ? '-' : ''}${row.id}:` + text.slice(completion?.end);
      setEditing(true);
      setDismissed(false);
      setSelectedIndex(layoutEnabled ? 1 : 0);
      setCaretAtEnd(true);
      onChange(chipQuery(chips, nextText));
      inputRef.current?.focus();
      return;
    }
    const target = layoutEnabled && row.operator && genericPrefix
      ? { operator: row.operator, start: text.length - genericPrefix[1].length, end: text.length, negated: completion?.negated }
      : active;
    if (!target) return;
    const before = text.slice(0, target.start - (genericPrefix && target.negated ? 1 : 0)).trim();
    const after = text.slice(target.end ?? text.length).trim();
    const selectedId = labelScopeEnabled && target.operator === 'label' && row.byName ? undefined : row.id;
    const selected = `${target.negated ? '-' : ''}${candidateQuery(target.operator, row.name, selectedId)}`;
    setChipLabels((previous) => ({ ...previous, [`${target.operator}:${selectedId ?? row.name}`]: row.name }));
    if (localRows === null || genericPrefix) setNames((previous) => ({ ...previous, [target.operator]: [...(previous[target.operator as keyof Names] ?? []), String(selectedId ?? row.name)] }));
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
    if (!layoutEnabled) onRun(next);
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
    const moveDown = event.key === "ArrowDown" || (tips && !layoutEnabled && event.key === "j");
    const moveUp = event.key === "ArrowUp" || (tips && !layoutEnabled && event.key === "k");
    if (open && (moveDown || moveUp)) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex((current) => Math.max(0, Math.min(rows.length - 1, current + (moveDown ? 1 : -1))));
      return;
    }
    // A lone Ask AI row is not a completion: Enter still runs the search.
    if (open && rows.length && !(layoutEnabled && event.key === "Enter" && selectedRow?.kind === "ai" && (selectedIndex !== 0 || rows.length === 1)) && (event.key === "Enter" || (event.key === "Tab" && (!autocompleteEnabled || !event.shiftKey)))) {
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
      setDismissed(true);
      onRun(value);
      if (value.trim().length >= 2) inputRef.current?.blur();
    }
  }

  function matched(label: string) {
    return highlightedTitle(label, lookupValue ?? '').map((part, index) => part.matched ? <strong key={index} className="font-semibold text-white-black">{part.text}</strong> : part.text);
  }

  function renderRow(row: Candidate, index: number) {
    const tip = tips && row.kind === 'operator' ? SEARCH_TIPS[row.operator!] : null;
    const recent = row.query !== undefined ? splitSearchChips(row.query, false, names, false, commenterEnabled) : null;
    return (
      <button key={`${row.kind}-${row.operator ?? ''}-${row.id}`} id={`mention-button-${index}`} type="button" role="option"
        aria-selected={row === selectedRow} onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(row)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
        data-search-layout-row={rowHighlightEnabled ? '' : undefined}
        className={`grid w-full min-w-0 grid-cols-1 gap-1 py-2 text-left text-dense text-white-black ${rowHighlightEnabled ? '' : `rounded-sm hover:bg-active-elementBg ${row === selectedRow ? 'bg-active-elementBg' : ''}`} ${row.email ? '@md:grid-cols-2 @md:gap-4' : ''}${labelScopeEnabled && row.count === 0 ? ' opacity-50' : ''}`}>
        {tip ? <span><strong className="block font-semibold">{tip.example}</strong><span className="text-meta text-text-light-gray">{tip.meaning}</span></span>
          : recent ? <span className="flex min-w-0 flex-wrap items-center gap-1 break-words">{recent.chips.map((chip, i) => <span key={i} className={`min-w-0 max-w-full break-all rounded-sm px-2 py-1 text-micro ${searchFilterColour(chip.operator)}`}>{chipText(chip)}</span>)}<span className="min-w-0 break-all">{recent.text}</span></span>
          : row.kind === 'ai' ? <span className="flex min-w-0 gap-2"><span className="shrink-0 font-semibold text-hypertasks-ai-purple">Ask AI</span><span className="min-w-0 break-words">{row.name}</span></span>
          : <span className="flex min-w-0 items-center gap-2 break-words">{row.email && <UserAvatar name={row.name} size={20} alt="" />}<span className="min-w-0 break-words">{matched(row.name)}</span>{labelScopeEnabled && row.count !== undefined && <span className="ml-auto shrink-0 text-right text-meta text-text-light-gray">{row.count}</span>}</span>}
        {row.email && <span className="min-w-0 break-all text-meta text-text-light-gray">{matched(row.email)}</span>}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full px-4 @md:px-9">
      <div className="flex min-h-10 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {chips.map((chip: SearchToken, index: number) => (
          <button
            key={`${chip.start}-${index}`}
            type="button"
            onClick={(event) => { event.stopPropagation(); remove(index); }}
            aria-label={`Remove ${chip.operator}:${chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value} filter`}
            className={`inline-flex ${layoutEnabled ? "min-w-0 max-w-full " : ""}items-center gap-1 rounded-sm px-2 py-1 text-content ${autocompleteEnabled ? `text-white-black border-l-2 ${searchFilterColour(chip.operator)}` : 'text-mention-highlight'}`}
            style={autocompleteEnabled ? undefined : { backgroundColor: "color-mix(in srgb, var(--color-mention-highlight) 12%, var(--bg-mention))" }}
          >
            {chip.operator === 'from' || chip.operator === 'commenter' || chip.operator === 'assignee' ? <UserRound size={14} aria-hidden="true" /> : (chip.operator === 'in' || chip.operator === 'board') ? <Hash size={14} aria-hidden="true" /> : null}
            <span className={layoutEnabled ? "min-w-0 break-all" : undefined}>{chipText(chip)}</span>
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
          onFocus={(event) => { setFocused(true); if (!layoutEnabled || !open) reopenPicker(event); }}
          onClick={reopenPicker}
          onSelect={(event) => setCaretAtEnd(event.currentTarget.selectionStart === text.length)}
          onBlur={(event) => { if (!layoutEnabled && !pickerRef.current?.contains(event.relatedTarget)) { setDismissed(true); setFocused(false); } }}
          role="combobox"
          aria-label="Search tasks"
          aria-autocomplete={autocompleteEnabled ? "both" : "list"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && rows.length ? `mention-button-${layoutEnabled ? rows.indexOf(selectedRow) : Math.min(selectedIndex, rows.length - 1)}` : undefined}
        />
        </div>
      </div>
      {open && layoutFlagEnabled && layoutRequested && autocompleteEnabled ? (
        <div ref={pickerRef} id={listId} role="listbox" aria-label="Search suggestions" data-search-layout
          className="mt-4 w-full min-w-0" onMouseDown={(event) => event.preventDefault()}>
          {tips ? <>
            <h2 className="mb-2 text-meta font-medium text-text-light-gray">Recent searches</h2>
            {rows.filter((row) => row.kind === 'recent').map((row) => renderRow(row, rows.indexOf(row)))}
            <h2 className="mb-2 mt-4 text-meta font-medium text-text-light-gray">Tips</h2>
            <div data-search-layout-tips className="grid min-w-0 grid-cols-1 gap-x-6 @md:grid-cols-2">{rows.filter((row) => row.kind === 'operator').map((row) => renderRow(row, rows.indexOf(row)))}</div>
          </> : rows.map(renderRow)}
          {!tips && loading && <div role="status" className="py-2 text-meta text-text-light-gray">Loading suggestions...</div>}
          {!tips && error && <div role="alert" className="py-2 text-meta text-text-light-gray">Could not load suggestions. Keep typing to retry.</div>}
          <div className="mt-4 text-meta text-text-light-gray">↑ ↓ to move · Tab / Enter to accept · Esc to close</div>
        </div>
      ) : open && (
        <div ref={pickerRef} className="absolute left-4 top-full z-30 max-w-[calc(100%-2rem)] @md:left-9" onMouseDown={(event) => event.preventDefault()}>
          {autocompleteEnabled && <div className="rounded-t-sm bg-modalBackground px-3 pt-2 text-meta text-text-light-gray">{tips ? 'Search tips' : 'Suggestions'} · {tips ? '↑ ↓ or j/k' : '↑ ↓'} to move · Tab / Enter to accept · Esc to close</div>}
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
      {summary && !layoutEnabled && <button type="button" className="mt-2 block text-left text-content text-white-black hover:bg-active-elementBg" onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }} onClick={() => onRun(value)}>Show results for: {summary}</button>}
    </div>
  );
}
