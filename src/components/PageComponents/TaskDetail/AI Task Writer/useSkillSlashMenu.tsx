import { Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import {
  fetchSlashSkills,
  slashTokenPrefix,
  type SlashSkill,
} from "@/lib/skills/slashSkills";

const TASKWRITER_SKILL_MENU_DOM_ID = "ht-taskwriter-skill-menu";


const TOKEN_RE = /(?:^|[\s(])\/([A-Za-z0-9-]*)$/;
const MENU_MAX_HEIGHT = 288;
const MENU_WIDTH = 340;

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

  const openRef = useRef(false);
  const itemsRef = useRef<SlashSkill[]>([]);
  const indexRef = useRef(0);
  const tokenStartRef = useRef(0);
  const genRef = useRef(0);

  const close = useCallback(() => {
    genRef.current++;
    openRef.current = false;
    setOpen(false);
  }, []);

  const computePlacement = useCallback(
    (tokenStart: number): Placement | null => {
      const el = textAreaRef.current;
      if (!el) return null;
      const caret = caretViewportRect(el, tokenStart);
      const left = Math.max(
        8,
        Math.min(caret.left, window.innerWidth - MENU_WIDTH - 8)
      );
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

  const handleInput = useCallback(
    (value: string, caret: number) => {
      const upto = value.slice(0, caret);
      const match = upto.match(TOKEN_RE);
      if (!match) {
        close();
        return;
      }
      const gen = ++genRef.current;
      fetchSlashSkills(projectId).then((skills) => {
        if (genRef.current !== gen) return;
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
        className="rounded-md shadow-xl bg-[var(--bg-editor-menu)] flex flex-col p-2 gap-2"
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
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                select(skill);
              }}
              className={`cursor-pointer text-content p-2 ${
                i === index ? "bg-[var(--bg-editor-option-selected)]" : "transparent"
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
