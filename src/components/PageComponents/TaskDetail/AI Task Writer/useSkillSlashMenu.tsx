import { Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import {
  fetchSlashSkills,
  slashTokenPrefix,
  type SlashSkill,
} from "@/lib/skills/slashSkills";

// Distinct from the chat/comment popup's SLASH_MENU_DOM_ID: AI chat's
// send-on-Enter treats that id as a global "a slash menu is open" flag, and the
// chat panel can be open alongside this popup. Sharing it would make chat drop
// messages whenever this menu is open.
const TASKWRITER_SKILL_MENU_DOM_ID = "ht-taskwriter-skill-menu";

// The chat "/" skill picker is a Tiptap suggestion extension, but the AI Task
// Writer / Write with AI input is a plain <textarea>. This hook reproduces the
// same picker for a textarea: it watches for a "/slug" token at the caret,
// lists the board + personal skills, and inserts "/slug " on select. The server
// resolver (src/app/api/ai/_lib/skills.ts) does the rest. Visual style mirrors
// CommandsList.tsx so the two surfaces match.

// Only match "/" at line start or after whitespace/"(" — same rule the server
// resolver enforces — so dates (7/7) and pasted URLs never trigger the menu.
const TOKEN_RE = /(?:^|[\s(])\/([A-Za-z0-9-]*)$/;
const MENU_MAX_HEIGHT = 288; // matches max-h-72 on the chat menu
const MENU_WIDTH = 340;

// Mirror-div technique: measure the pixel position of a character index inside a
// textarea (a textarea has no per-character geometry API). Lets the menu hang off
// the typed "/" like the chat picker's caret-anchored popup, instead of floating
// at the textarea's corner. Coordinates are relative to the textarea's top-left.
const MIRROR_PROPS = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
  "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration",
  "letterSpacing", "wordSpacing", "tabSize",
] as const;

function caretViewportRect(el: HTMLTextAreaElement, index: number) {
  const cs = getComputedStyle(el);
  const div = document.createElement("div");
  const s = div.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  s.overflow = "hidden";
  for (const p of MIRROR_PROPS) (s as any)[p] = (cs as any)[p];
  div.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(index) || ".";
  div.appendChild(marker);
  document.body.appendChild(div);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const caretTop = marker.offsetTop + parseFloat(cs.borderTopWidth);
  const caretLeft = marker.offsetLeft + parseFloat(cs.borderLeftWidth);
  document.body.removeChild(div);
  const rect = el.getBoundingClientRect();
  const top = rect.top + caretTop - el.scrollTop;
  const left = rect.left + caretLeft - el.scrollLeft;
  return { top, left, bottom: top + lineHeight };
}

type Placement = { left: number; width: number } & (
  | { top: number; bottom?: undefined }
  | { bottom: number; top?: undefined }
);

export function useSkillSlashMenu({
  textAreaRef,
  setValue,
  returnUserInputHandler,
}: {
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  setValue: (v: string) => void;
  returnUserInputHandler?: (v: string) => void;
}) {
  const [currentProject] = useRecoilState(currentProjectAtom);
  const projectId = currentProject?.id;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SlashSkill[]>([]);
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Refs so the keydown handler (called before the parent's send handler) always
  // reads the latest state without being recreated on every keystroke.
  const openRef = useRef(false);
  const itemsRef = useRef<SlashSkill[]>([]);
  const indexRef = useRef(0);
  const tokenStartRef = useRef(0);
  // Bumped on every new trigger and on close(), so a slow first-time skills
  // fetch that resolves after the user dismissed (Escape/blur) or moved on can
  // tell it's stale and not reopen the menu (which would swallow a pending
  // Enter and corrupt the prompt).
  const genRef = useRef(0);

  const close = useCallback(() => {
    genRef.current++;
    openRef.current = false;
    setOpen(false);
  }, []);

  // Anchor at the typed "/" (the token start), not the textarea box, so the menu
  // hangs off the caret like the chat picker.
  const computePlacement = useCallback(
    (tokenStart: number): Placement | null => {
      const el = textAreaRef.current;
      if (!el) return null;
      const caret = caretViewportRect(el, tokenStart);
      const left = Math.max(
        8,
        Math.min(caret.left, window.innerWidth - MENU_WIDTH - 8)
      );
      // Flip up when there isn't room below the caret line, otherwise drop down.
      const openUp = caret.bottom + MENU_MAX_HEIGHT + 8 > window.innerHeight;
      return openUp
        ? { left, width: MENU_WIDTH, bottom: window.innerHeight - caret.top + 4 }
        : { left, width: MENU_WIDTH, top: caret.bottom + 4 };
    },
    [textAreaRef]
  );

  const showMenu = useCallback(
    (tokenStart: number, query: string, skills: SlashSkill[]) => {
      const q = query.toLowerCase();
      const filtered = q
        ? skills.filter(
            (s) =>
              s.slug.toLowerCase().includes(q) ||
              s.name.toLowerCase().includes(q)
          )
        : skills;
      if (filtered.length === 0) {
        close();
        return;
      }
      tokenStartRef.current = tokenStart;
      itemsRef.current = filtered;
      indexRef.current = 0;
      openRef.current = true;
      setItems(filtered);
      setIndex(0);
      setPlacement(computePlacement(tokenStart));
      setOpen(true);
    },
    [close, computePlacement]
  );

  // Detect (or dismiss) the "/slug" token for the given text + caret position.
  const handleInput = useCallback(
    (value: string, caret: number) => {
      const upto = value.slice(0, caret);
      const match = upto.match(TOKEN_RE);
      if (!match) {
        close();
        return;
      }
      const gen = ++genRef.current; // this trigger supersedes any pending fetch
      // fetchSlashSkills has its own 60s in-module cache (a cache hit resolves
      // on the next microtask), so calling it per trigger stays cheap and, unlike
      // a component-lifetime local cache, still picks up skills added/edited after
      // the first "/" — matching the chat picker's freshness.
      fetchSlashSkills(projectId).then((skills) => {
        // Stale if the user dismissed (Escape/blur) or triggered again while we
        // fetched — don't reopen over their next keystroke.
        if (genRef.current !== gen) return;
        // Re-read the caret: the user may have typed on while we fetched.
        const el = textAreaRef.current;
        const liveCaret = el?.selectionStart ?? caret;
        const liveMatch = (el?.value ?? value).slice(0, liveCaret).match(TOKEN_RE);
        if (!liveMatch) return;
        showMenu(liveCaret - liveMatch[1].length - 1, liveMatch[1], skills);
      });
    },
    [projectId, showMenu, close, textAreaRef]
  );

  const onCaretMove = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    handleInput(el.value, el.selectionStart ?? el.value.length);
  }, [handleInput, textAreaRef]);

  const select = useCallback(
    (skill: SlashSkill) => {
      const el = textAreaRef.current;
      if (!el) return;
      const value = el.value;
      const caret = el.selectionStart ?? value.length;
      const tokenStart = tokenStartRef.current;
      const before = value.slice(0, tokenStart);
      const prefix = slashTokenPrefix(before.slice(-1));
      const insert = `${prefix}/${skill.slug} `;
      const newValue = before + insert + value.slice(caret);
      setValue(newValue);
      returnUserInputHandler?.(newValue);
      close();
      const newCaret = (before + insert).length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
      });
    },
    [textAreaRef, setValue, returnUserInputHandler, close]
  );

  // Returns true when it consumed the key, so the parent skips its own Enter =
  // submit / arrow handling. stopPropagation on select mirrors the chat fix so
  // picking a skill never also fires the send.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!openRef.current) return false;
      const list = itemsRef.current;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        indexRef.current = (indexRef.current + 1) % list.length;
        setIndex(indexRef.current);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        indexRef.current = (indexRef.current - 1 + list.length) % list.length;
        setIndex(indexRef.current);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (list.length === 0) return false;
        e.preventDefault();
        e.stopPropagation();
        select(list[indexRef.current]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Stop the container's Escape handler from also closing the whole
        // task-writer popup — this press only dismisses the menu.
        e.stopPropagation();
        close();
        return true;
      }
      return false;
    },
    [select, close]
  );

  const menu =
    open && placement ? (
      <div
        id={TASKWRITER_SKILL_MENU_DOM_ID}
        style={{
          position: "fixed",
          left: placement.left,
          width: placement.width,
          ...(placement.top !== undefined
            ? { top: placement.top }
            : { bottom: placement.bottom }),
          zIndex: 9999,
        }}
        className="rounded-md shadow-xl dark:bg-[#333B47] bg-[#ffffff] flex flex-col p-2 gap-2"
      >
        <ul className="max-h-72 no-scrollbar scrollbar-none overflow-y-auto gap-1">
          {items.map((skill, i) => (
            <li
              id={`skill-command-${i}`}
              key={skill.slug}
              onMouseEnter={() => {
                indexRef.current = i;
                setIndex(i);
              }}
              // preventDefault keeps textarea focus so the click lands before blur.
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                select(skill);
              }}
              className={`cursor-pointer text-content p-2 ${
                i === index ? "bg-[#ececec] dark:bg-[#4f5766]" : "transparent"
              } rounded-md py-1`}
            >
              <div className="flex gap-2 items-start px-1">
                <Sparkles
                  size={16}
                  className="mt-[2px] text-gray-400"
                  strokeWidth={1.75}
                />
                <div>
                  <div className="flex gap-1">
                    <h3 className="text-[#C668FF]">SKILL</h3>
                    <h3 className="text-content text-white-black">{`/${skill.slug}`}</h3>
                  </div>
                  <span className="text-meta text-gray-400">
                    {skill.description || skill.name}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return { onKeyDown, onInput: handleInput, onCaretMove, close, menu };
}
