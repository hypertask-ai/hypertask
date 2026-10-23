"use client";

import UserAvatar from "@/components/Common/UserAvatar";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { HTPR_6371_MOBILE_SEARCH_FLAG, HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG, HTPR_7387_SEARCH_OPERATOR_COLOURS_FLAG, HTPR_7563_SEARCH_ESC_FOOTER_FLAG, HTPR_7559_ENTER_RUNS_SEARCH_FLAG } from "@/lib/flags/keys";
import { isMobileSearchSubmit, mobileSearchPickerBounds } from "@/lib/search/mobile";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6994_SEARCH_ESC_LEAVES_FLAG } from "@/lib/flags/keys";
import { MentionListRows } from "@/components/AI_CHAT/MentionListComp";
import { candidateQuery, chipQuery, searchChipText, splitSearchChips } from "@/lib/search/chips";
import { operatorMatches, parseSearchTokens, SEARCH_OPERATORS, LOGIC_OPERATORS, type Names, type SearchToken } from "@/lib/search/operators";
import { localValueSuggestions, operatorSuggestions, searchCompletion, searchFilterColour, highlightedTitle, SEARCH_TIPS, type SearchCandidate } from "@/lib/search/autocomplete";
import { searchConfig } from "@/lib/configs/search.config";
import { Hash, UserRound, X } from "lucide-react";
import React, { type ChangeEvent, type KeyboardEvent, type RefObject, useContext, useEffect, useRef, useState } from "react";

type Candidate = SearchCandidate & { count?: number; byName?: boolean; query?: string; operator?: SearchToken['operator']; tip?: keyof typeof SEARCH_TIPS; kind?: "ai" | "operator" | "value" | "recent" };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  boardId: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  recentSearches?: string[];
  layoutEnabled?: boolean;
  availableBoards?: { id: number; title?: string }[];
  onAskAi?: (readableQuery?: string) => void;
  showSuggestions?: boolean;
};

function typedFilter(text: string, completion: ReturnType<typeof searchCompletion>) {
  return completion?.kind === 'value' && /^-?[a-z]+:/i.test(text.slice(completion.start));
}

export default function SearchChipsInput({ value, onChange, onRun, boardId, inputRef, recentSearches = [], layoutEnabled: layoutRequested = false, availableBoards = [], onAskAi, showSuggestions = true }: Props) {
  const mobileFlagEnabled = useFlag(HTPR_6371_MOBILE_SEARCH_FLAG);
  const isMobile = useContext(MobileViewContext);
  const mobileEnabled = mobileFlagEnabled && isMobile;
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const [mobileBounds, setMobileBounds] = useState<(ReturnType<typeof mobileSearchPickerBounds> & { left: number; width: number }) | null>(null);
  const layoutEnabled = layoutRequested;
  const enterRunsSearchFlagEnabled = useFlag(HTPR_7559_ENTER_RUNS_SEARCH_FLAG);
  const enterRunsSearchEnabled = enterRunsSearchFlagEnabled && layoutEnabled && !mobileEnabled;
  const labelScopeEnabled = layoutEnabled;
  const escLeavesEnabled = useFlag(HTPR_6994_SEARCH_ESC_LEAVES_FLAG);
  const escFooterEnabled = useFlag(HTPR_7563_SEARCH_ESC_FOOTER_FLAG);
  const escFooterText = escFooterEnabled && escLeavesEnabled ? 'Esc to go back' : 'Esc to close';
  const operatorLogicEnabled = useFlag(HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG);
  const operatorColoursEnabled = useFlag(HTPR_7387_SEARCH_OPERATOR_COLOURS_FLAG);
  const logicEnabled = operatorLogicEnabled && operatorColoursEnabled;
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Names>({});
  const [chipLabels, setChipLabels] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
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
  const { chips, text } = splitSearchChips(value, editing, queryNames, true, layoutEnabled, logicEnabled);
  const pickedBoards = labelScopeEnabled ? [...new Set(parseSearchTokens(value, queryNames)
    .filter((token) => !token.negated && (token.operator === 'in' || token.operator === 'board'))
    .flatMap((token) => {
      const name = token.value.replace(/^#/, '').trim();
      return /^\d+$/.test(name) ? [Number(name)] : availableBoards
        .filter((board) => board.title?.toLowerCase() === name.toLowerCase()).map((board) => board.id);
    }))].join(',') : '';
  const summary = [...chips.map(chipText), text.trim()].filter(Boolean).join(' ');
  const completion = operatorColoursEnabled
    ? searchCompletion(text, names, layoutEnabled, operatorLogicEnabled)
    : searchCompletion(text, names, layoutEnabled);
  const tips = (focused || layoutEnabled) && !value.trim();
  const plainSearch = enterRunsSearchEnabled && !tips && !typedFilter(text, completion);
  const defaultSelectedIndex = plainSearch ? -1 : layoutEnabled && !tips ? 1 : 0;
  const [selectedIndex, setSelectedIndex] = useState(enterRunsSearchEnabled ? defaultSelectedIndex : 0);
  const picker = dismissed ? null : completion;
  const localRows = completion?.kind === 'operator'
    ? operatorSuggestions(completion.value, layoutEnabled, logicEnabled).map((operator) => ({ id: operator, name: `${operator}:` }))
    : completion ? localValueSuggestions(completion.operator, completion.value) : null;
  const genericPrefix = layoutEnabled && !dismissed && showSuggestions && completion?.kind !== 'value' &&
    (text.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 0 ? text.match(/(?:^|\s)([a-z]+)$/i) : null;
  const lookupValue = genericPrefix?.[1] ?? picker?.value;
  const rows: Candidate[] = tips ? [
    ...(layoutEnabled ? [...new Set(recentSearches)] : recentSearches).map((query, index) => ({ id: `recent-${index}`, name: layoutEnabled ? query : `Recent: ${query}`, query, kind: 'recent' as const })),
    ...[...SEARCH_OPERATORS, ...(logicEnabled ? [...LOGIC_OPERATORS, 'phrase', 'exclude'] as const : [])].filter((tip) => tip !== 'commenter' || layoutEnabled).map((tip) => ({ id: tip, name: `${SEARCH_TIPS[tip].example} - ${SEARCH_TIPS[tip].meaning}`, tip, kind: 'operator' as const })),
  ] : layoutEnabled ? [
    ...(value.trim() ? [{ id: 'ask-ai', name: labelScopeEnabled ? summary : value.trim(), kind: 'ai' as const }] : []),
    ...(localRows ?? []).map((row) => ({ ...row, kind: completion?.kind === 'operator' ? 'operator' as const : 'value' as const })),
    ...((localRows === null || genericPrefix) ? candidates.map((row) => ({ ...row, kind: 'value' as const })) : []),
  ] : localRows ?? candidates;
  const open = !(mobileEnabled && composing) && ((layoutEnabled && tips) || (!dismissed && (layoutEnabled ? focused && showSuggestions && Boolean(value.trim() || tips) : Boolean(picker || tips))));
  const openRef = useRef(open);
  openRef.current = open;
  const listId = "search-chip-options";
  const selectedRow = enterRunsSearchEnabled && selectedIndex < 0 ? undefined : rows[selectedIndex] ?? rows[layoutEnabled && !tips ? 1 : 0] ?? rows[0];
  const ghost = open && caretAtEnd && selectedRow && completion?.kind === 'operator' && (!layoutEnabled || selectedRow.kind === 'operator')
    ? String(selectedRow.id).slice(completion.value.length) + ':'
    : open && layoutEnabled && caretAtEnd && completion?.kind === 'value' && selectedRow?.kind === 'value' &&
      ['from', 'commenter', 'assignee', 'in', 'board', 'label'].includes(completion.operator) && completion.value &&
      /^-?(from|commenter|assignee|in|board|label):/i.test(text.slice(completion.start)) && !text.endsWith('"') &&
      selectedRow.name.toLowerCase().startsWith(completion.value.toLowerCase())
      ? selectedRow.name.slice(completion.value.length) : '';

  const mobileOverlay = mobileEnabled && focused && Boolean(value.trim() || open);
  const pickerStyle: React.CSSProperties | undefined = mobileOverlay && mobileBounds ? {
    position: 'fixed', top: mobileBounds.top, left: mobileBounds.left, width: mobileBounds.width,
    height: mobileBounds.height, marginTop: 0, overflowY: 'auto', overflowX: 'hidden', zIndex: 301,
  } : undefined;

  useEffect(() => {
    if (!mobileOverlay) { setMobileBounds(null); return; }
    const viewport = window.visualViewport;
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const left = rect.left + parseFloat(style.paddingLeft);
      const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const dock = document.querySelector<HTMLElement>('nav[aria-label="Primary navigation"]');
      const dockRect = dock?.getBoundingClientRect();
      const dockTop = dockRect && dockRect.height && dockRect.top < viewportTop + viewportHeight && dockRect.bottom > viewportTop ? dockRect.top : undefined;
      const next = { ...mobileSearchPickerBounds(viewportTop, viewportHeight, container.firstElementChild!.getBoundingClientRect().bottom, dockTop), left, width };
      setMobileBounds((previous) => previous && (Object.keys(next) as (keyof typeof next)[]).every((key) => previous[key] === next[key]) ? previous : next);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
      measure();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current!);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [mobileOverlay]);

  useEffect(() => {
    if (!open) return;
    const list = (mobileEnabled && pickerRef.current?.querySelector<HTMLElement>(`#${listId}`)) || pickerRef.current;
    const row = list?.querySelector<HTMLElement>(`#mention-button-${selectedIndex}`);
    if (mobileEnabled && list && row) {
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
      else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
    } else row?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex, rows.length, mobileEnabled, mobileBounds]);

  useEffect(() => {
    if (!mobileEnabled) return;
    const input = inputRef.current;
    const beforeInput = (event: InputEvent) => {
      if (!isMobileSearchSubmit(event.inputType, composingRef.current || event.isComposing)) return;
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      setDismissed(true);
      onRun(value);
    };
    input?.addEventListener('beforeinput', beforeInput);
    return () => input?.removeEventListener('beforeinput', beforeInput);
  }, [mobileEnabled, value, onRun, inputRef]);

  useEffect(() => {
    if (!layoutEnabled) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setDismissed(true);
        setFocused(false);
      }
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (escLeavesEnabled || event.key !== 'Escape' || document.activeElement === inputRef.current || !openRef.current) return;
      event.preventDefault();
      setDismissed(true);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [layoutEnabled, escLeavesEnabled]);

  useEffect(() => {
    setEditing(false);
    setDismissed(false);
  }, [boardId]);

  useEffect(() => {
    if (layoutEnabled && !showSuggestions) setEditing(false);
  }, [layoutEnabled, showSuggestions, value]);

  useEffect(() => {
    if (enterRunsSearchEnabled) setSelectedIndex(defaultSelectedIndex);
    if (!(genericPrefix || picker) || (!genericPrefix && (completion?.kind === 'operator' || localRows !== null))) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const request = ++lookup.current;
    setLoading(true);
    setError(false);
    setCandidates([]);
    setSelectedIndex(defaultSelectedIndex);
    const operators = genericPrefix ? ['from', 'label', 'in'] as const : [picker!.operator as SearchToken['operator']];
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
  }, [picker?.operator, picker?.value, dismissed, boardId, layoutEnabled, genericPrefix?.[1], labelScopeEnabled, pickedBoards, logicEnabled, enterRunsSearchEnabled, defaultSelectedIndex]);

  useEffect(() => {
    if (editing) return;
    const queries = layoutEnabled && !value.trim() ? [value, ...new Set(recentSearches)] : [value];
    const tokens = queries.flatMap((query) => parseSearchTokens(query, names, layoutEnabled, logicEnabled).map((token) => ({ ...token, query })));
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
  }, [value, editing, boardId, layoutEnabled, layoutEnabled ? recentSearches.join('\n') : '', labelScopeEnabled, pickedBoards, logicEnabled]);

  function change(event: ChangeEvent<HTMLInputElement> | React.CompositionEvent<HTMLInputElement>) {
    setEditing(Boolean(event.currentTarget.value.trim()));
    setDismissed(false);
    const nextText = event.currentTarget.value;
    const typingPlainWords = enterRunsSearchEnabled && nextText.trim() && !typedFilter(nextText, searchCompletion(nextText, names, layoutEnabled, logicEnabled));
    setSelectedIndex(typingPlainWords ? -1 : layoutEnabled && nextText.trim() ? 1 : 0);
    setCaretAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length);
    onChange(chipQuery(chips, event.currentTarget.value) + (/\s$/.test(event.currentTarget.value) ? ' ' : ''));
  }

  function reopenPicker(event: React.SyntheticEvent<HTMLInputElement>) {
    const caret = event.currentTarget.selectionStart;
    setCaretAtEnd(caret === text.length);
    if (!value.trim()) { setDismissed(false); setSelectedIndex(0); }
    if (layoutEnabled && showSuggestions && value.trim()) { setDismissed(false); setSelectedIndex(defaultSelectedIndex); }
    if (completion?.kind === 'operator' && caret === text.length) setDismissed(false);
    const atCaret = caret === null ? null : searchCompletion(text.slice(0, caret), names, layoutEnabled, logicEnabled);
    if (completion && caret !== null && caret <= (completion.end ?? text.length) && atCaret?.start === completion.start) setDismissed(false);
  }

  function chipText(chip: SearchToken) {
    const name = chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value;
    return searchChipText(chip, name, layoutEnabled);
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
    if (tips || (completion?.kind === 'operator' && (!layoutEnabled || row.kind === 'operator'))) {
      const nextText = tips ? row.tip === 'phrase' || row.tip === 'exclude' ? SEARCH_TIPS[row.tip].example : `${row.id}:` : text.slice(0, completion?.start) + `${completion?.negated ? '-' : ''}${row.id}:` + text.slice(completion?.end);
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
      : completion;
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

  function runSearch() {
    setEditing(false);
    setDismissed(true);
    onRun(value);
    if (!mobileEnabled && value.trim().length >= 2) inputRef.current?.blur();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (mobileEnabled && (composingRef.current || event.nativeEvent.isComposing)) return;
    if (mobileEnabled && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      runSearch();
      return;
    }
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (open && event.key === "Escape" && !escLeavesEnabled) {
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
      setSelectedIndex((current) => Math.max(plainSearch ? -1 : 0, Math.min(rows.length - 1, current + (moveDown ? 1 : -1))));
      return;
    }
    if (open && !selectedRow && rows[1] && event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      choose(rows[1]);
      return;
    }
    if (open && rows.length && selectedRow && !(layoutEnabled && event.key === "Enter" && selectedRow?.kind === "ai" && (selectedIndex !== 0 || (!enterRunsSearchEnabled && rows.length === 1))) && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
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
      runSearch();
    }
  }

  function matched(label: string) {
    return highlightedTitle(label, lookupValue ?? '').map((part, index) => part.matched ? <strong key={index} className="font-semibold text-white-black">{part.text}</strong> : part.text);
  }

  function renderRow(row: Candidate, index: number) {
    const tip = tips && row.tip ? SEARCH_TIPS[row.tip] : null;
    const recent = row.query !== undefined ? splitSearchChips(row.query, false, names, false, layoutEnabled, logicEnabled) : null;
    return (
      <button key={`${row.kind}-${row.operator ?? ''}-${row.id}`} id={`mention-button-${index}`} type="button" role="option"
        aria-selected={row === selectedRow} onPointerDown={(event) => { if (mobileEnabled) event.preventDefault(); }} onMouseEnter={() => setSelectedIndex(index)} onClick={() => choose(row)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
        data-search-layout-row=""
        className={`grid w-full min-w-0 ${mobileEnabled ? "min-h-[44px] " : ""}grid-cols-1 gap-1 py-2 text-left text-dense text-white-black ${row.email ? '@md:grid-cols-2 @md:gap-4' : ''}${labelScopeEnabled && row.count === 0 ? ' opacity-50' : ''}`}>
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
            onPointerDown={(event) => { if (mobileEnabled) event.preventDefault(); }}
            onClick={(event) => { event.stopPropagation(); remove(index); }}
            aria-label={`Remove ${chip.operator}:${chipLabels[`${chip.operator}:${chip.value}`] ?? chip.value} filter`}
            className={`inline-flex ${mobileEnabled ? "min-h-[44px] min-w-[44px] max-w-full " : ""}${layoutEnabled ? "min-w-0 max-w-full " : ""}items-center gap-1 rounded-sm px-2 py-1 text-content text-white-black border-l-2 ${searchFilterColour(chip.operator)}`}
          >
            {chip.operator === 'from' || chip.operator === 'commenter' || chip.operator === 'assignee' ? <UserRound className={mobileEnabled ? "shrink-0" : undefined} size={14} aria-hidden="true" /> : (chip.operator === 'in' || chip.operator === 'board') ? <Hash className={mobileEnabled ? "shrink-0" : undefined} size={14} aria-hidden="true" /> : null}
            <span className={mobileEnabled ? "min-w-0 max-w-[200px] truncate" : layoutEnabled ? "min-w-0 break-all" : undefined}>{chipText(chip)}</span>
            <X size={14} strokeWidth={1.5} className={mobileEnabled ? "shrink-0" : undefined} aria-hidden="true" />
          </button>
        ))}
        <div className="relative min-w-[8rem] flex-1 text-subheading font-medium">
          {(completion || ghost) && (
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
          onCompositionStart={mobileEnabled ? () => { composingRef.current = true; setComposing(true); } : undefined}
          onCompositionEnd={mobileEnabled ? (event) => {
            composingRef.current = false;
            setComposing(false);
            change(event);
          } : undefined}
          onKeyDown={keyDown}
          onFocus={(event) => { setFocused(true); if (!layoutEnabled || !open) reopenPicker(event); }}
          onClick={reopenPicker}
          onSelect={(event) => setCaretAtEnd(event.currentTarget.selectionStart === text.length)}
          onBlur={(event) => { if (!layoutEnabled && !pickerRef.current?.contains(event.relatedTarget)) { setDismissed(true); setFocused(false); } }}
          role="combobox"
          aria-label="Search tasks"
          aria-autocomplete="both"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && rows.length && selectedRow ? `mention-button-${layoutEnabled ? rows.indexOf(selectedRow) : Math.min(selectedIndex, rows.length - 1)}` : undefined}
        />
        </div>
      </div>
      {open && layoutRequested ? (
        <div ref={pickerRef} id={listId} role="listbox" aria-label="Search suggestions" data-search-layout
          style={pickerStyle} className={`w-full min-w-0 ${mobileOverlay ? "bg-containerBackground" : "mt-4"}`} onMouseDown={(event) => event.preventDefault()}>
          {tips ? <>
            <h2 className="mb-2 text-meta font-medium text-text-light-gray">Recent searches</h2>
            {rows.filter((row) => row.kind === 'recent').map((row) => renderRow(row, rows.indexOf(row)))}
            <h2 className="mb-2 mt-4 text-meta font-medium text-text-light-gray">Tips</h2>
            <div data-search-layout-tips className="grid min-w-0 grid-cols-1 gap-x-6 @md:grid-cols-2">{rows.filter((row) => row.kind === 'operator').map((row) => renderRow(row, rows.indexOf(row)))}</div>
          </> : rows.map(renderRow)}
          {!tips && loading && <div role="status" className="py-2 text-meta text-text-light-gray">Loading suggestions...</div>}
          {!tips && error && <div role="alert" className="py-2 text-meta text-text-light-gray">Could not load suggestions. Keep typing to retry.</div>}
          {!(mobileFlagEnabled && isMobile) && <div className="mt-4 text-meta text-text-light-gray">↑ ↓ to move · {plainSearch && !selectedRow ? 'Tab to accept · Enter to search' : 'Tab / Enter to accept'} · {escFooterText}</div>}
        </div>
      ) : open && (
        <div ref={pickerRef} style={pickerStyle} className="absolute left-4 top-full z-30 max-w-[calc(100%-2rem)] @md:left-9" onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => { if (mobileEnabled) event.preventDefault(); }}>
          {!mobileEnabled && <div className="rounded-t-sm bg-modalBackground px-3 pt-2 text-meta text-text-light-gray">{tips ? 'Search tips' : 'Suggestions'} · {tips ? '↑ ↓ or j/k' : '↑ ↓'} to move · Tab / Enter to accept · {escFooterText}</div>}
          {error && localRows === null && !tips ? <div id={listId} role="alert" className="rounded bg-modalBackground p-3 text-white-black">Could not load suggestions. Keep typing to retry.</div> : (
            <MentionListRows
              id={listId}
              loadingLabel="Loading suggestions..."
              className={mobileEnabled ? "w-full h-full max-h-full max-w-full [&_button]:min-h-[44px]" : "max-w-full"}
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
      {summary && (!layoutEnabled || mobileOverlay) && <button type="button"
        style={mobileOverlay && mobileBounds ? { position: 'fixed', top: mobileBounds.summaryTop, left: mobileBounds.left, width: mobileBounds.width, marginTop: 0, zIndex: 301 } : undefined}
        className={`block text-left text-content text-white-black hover:bg-active-elementBg ${mobileOverlay ? "min-h-[44px] h-11 truncate bg-containerBackground" : "mt-2"}`}
        onPointerDown={(event) => { if (mobileEnabled) event.preventDefault(); }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }} onClick={mobileEnabled ? runSearch : () => onRun(value)}>Show results for: {summary}</button>}
    </div>
  );
}
