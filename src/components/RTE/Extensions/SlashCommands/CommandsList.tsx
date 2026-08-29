
import { currentProjectAtom } from "@/store";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import AILogo from "@/assets/AILogo.png"
import {
  buildSkillSlashItems,
  fetchSlashSkills,
  SLASH_MENU_DOM_ID,
  type SkillSlashItem,
} from "@/lib/skills/slashSkills";

// Modes whose "/" menu also lists imported skills (board + personal).
const SKILL_SLASH_MODES = ["create-comment", "ai-chat"];
export type SuggestionListRef = {
  onKeyDown: NonNullable<
    ReturnType<
      NonNullable<SuggestionOptions["render"]>
    >["onKeyDown"]
  >;
};

export type SuggestionListProps = SuggestionProps;
const CommandsList = forwardRef<SuggestionListRef, SuggestionListProps>(
  (props, ref) => {
    const [currentProject, _] =useRecoilState(currentProjectAtom);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [skillItems, setSkillItems] = useState<SkillSlashItem[]>([]);
    const mode = (props.editor?.storage as any)?.slashCommands?.mode as
      | string
      | undefined;
    const skillsEnabled = !!mode && SKILL_SLASH_MODES.includes(mode);
    // Track whether this editor ever had base commands. Tiptap v3 emits a
    // transient empty props.items frame between keystrokes; once we've seen real
    // base items, an empty frame is that loading placeholder (keep the prior
    // list). For skills-only menus (AI chat) base is always empty and that is the
    // steady state, so we must still render the skills.
    const everHadBase = useRef(false);
    const lastBase = useRef<any[]>([]);
    if ((props.items?.length ?? 0) > 0) everHadBase.current = true;

    useEffect(() => {
      if (!skillsEnabled) {
        setSkillItems([]);
        return;
      }
      let cancelled = false;
      fetchSlashSkills(currentProject?.id).then((skills) => {
        if (!cancelled) setSkillItems(buildSkillSlashItems(skills));
      });
      return () => {
        cancelled = true;
      };
    }, [skillsEnabled, currentProject?.id]);
    // const itemsFinal = props.items.map(item => {
    //     // console.log("🚀 ~ itemsFinal ~ currentProject?.team.subscriptionPlan:", currentProject?.team)
    //     if (item.type && item.type === "AI") {
    //       const itemtoReturn = currentProject?.team.activeSubscriptionPlanId ? item : false;
    //       // console.log("🚀 ~ itemsFinal ~ itemtoReturn:", itemtoReturn)
    //       return itemtoReturn;
    //     }
    //     return item;
    //   }).filter(Boolean);
  
    // console.log("🚀 ~ itemsFinal ~ itemsFinal:", itemsFinal)
    const [filteredItems, setFilteredItems] = useState(props.items)
    const selectItem = (index: number) => {
      if (index >= filteredItems.length) {
        return;
      }

      const command = {
        ...filteredItems[index],
        currentProjectId: currentProject?.id,
      };

      //@ts-ignore
      props.command(command );
    };

    const upHandler = () => {
      const selectedIdx=(selectedIndex + filteredItems.length - 1) % filteredItems.length
      setSelectedIndex(selectedIdx);
      document.getElementById(`command-${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"})

    };

    const downHandler = () => {
      const selectedIdx=(selectedIndex + 1) % filteredItems.length

      setSelectedIndex((selectedIndex + 1) % filteredItems.length);
      document.getElementById(`command-${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"})

    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    useEffect(() => setSelectedIndex(0), [filteredItems]);

    
    useEffect(() => {
      // v3 delivers suggestion items asynchronously: every update arrives first
      // as an empty "loading" array, then the real items. Skip those transient
      // empty frames so the menu doesn't flicker/collapse to a 0x0 popup between
      // keystrokes. Only treat empty as "loading" once we've actually seen base
      // items (see everHadBase) — an AI-chat menu is skills-only and legitimately
      // has no base items, so it must still render.
      const currentBase = props.items ?? [];
      const baseIsLoadingPlaceholder =
        currentBase.length === 0 && everHadBase.current;
      if (baseIsLoadingPlaceholder && skillItems.length === 0) return;
      // Keep the last real base list during a placeholder frame so base commands
      // don't blink out for a frame when skills are also present.
      const base = baseIsLoadingPlaceholder ? lastBase.current : currentBase;
      if (!baseIsLoadingPlaceholder) lastBase.current = currentBase;
      const normalizedQuery = props.query.toLowerCase();
      // Skills go at the bottom, below the built-in commands (in the AI chat
      // base is empty, so the menu is skills-only there regardless).
      const source = [...base, ...skillItems];
      const filteredResults = source.filter((item) =>
        item.type?.toLowerCase().includes(normalizedQuery) ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.aliases?.some((alias: string) =>
          alias.toLowerCase().includes(normalizedQuery)
        )
      );
    setFilteredItems(filteredResults)
    setSelectedIndex(0);
    // Depend on props.items (not just props.query) so the list populates when the
    // async items land, and on skillItems so it re-renders when skills resolve.
    }, [props.query, props.items, skillItems])
    

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          upHandler();
          return true;
        }

        if (event.key === "ArrowDown") {
          downHandler();
          return true;
        }

        if (event.key === "Enter") {
          // SlashCommands is configured with allowedPrefixes: null (mid-text
          // trigger, HTPR-3847), so the suggestion silently activates whenever a
          // "/" appears with no preceding whitespace required, e.g. dates
          // (7/7), "and/or", or a pasted Hypertask/URL link, which is packed
          // with slashes. With no matching command, filteredItems is empty and
          // this component renders nothing, but this handler still claimed
          // Enter unconditionally, silently eating every Enter keystroke until
          // the suggestion state reset (HTPR-3972). Only claim Enter when
          // there's an actual item to select, otherwise let it fall through to
          // the editor's normal Enter (new paragraph) handling.
          if (filteredItems.length === 0) return false;
          enterHandler();
          return true;
        }

        return false;
      },
    }));
    return filteredItems.length > 0 ? (
      <div
        id={SLASH_MENU_DOM_ID}
        className="rounded-md shadow-xl dark:bg-[#333B47] bg-[#ffffff]   flex flex-col p-2 gap-2"
        style={{ maxHeight: "calc(100dvh - 24px)" }}
      >
        <ul 
          className="min-h-0 max-h-72 no-scrollbar scrollbar-none overflow-y-auto gap-1"
            >
          {filteredItems.map((item, index) => (
            <li
              id={`command-${index}`}
              key={item.title}
              onMouseEnter={()=>setSelectedIndex(index)}
              // Use onMouseDown + preventDefault (like the mention list) so the
              // editor keeps focus. A plain onClick blurs the editor on mousedown,
              // which tears down the suggestion popup before the click registers,
              // making menu items feel unclickable with the mouse.
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                selectItem(index);
              }}
              className={`cursor-pointer text-content p-2 ${
                  index === selectedIndex ? "bg-[#ececec] dark:bg-[#4f5766]" : "transparent"
                } rounded-md py-1 px4 `}
            >
            <div 
                className="flex gap-2 items-start px-1 "
                >
              {
                item.type==="AI"?
                <img className="mt-[2px]" height={20} width={16} src={AILogo.src} alt="ai" />
              :
              <item.icon
                size={16}
                className="mt-[2px] text-gray-400 "
                strokeWidth={1.75}
              />
              }
              
              
              <div
                >
                <div className="flex gap-1">
                  {
                    item.type&&
                    <h3 className="text-[#C668FF]">
                      {item.type === "AI" ? "AI" : item.type}
                    </h3>
                  }
                  <h3 className="text-content text-white-black">
                      {item.title}
                  </h3>
                </div>
                <span className="text-meta text-gray-400">
                    {item.text}
                </span>
              </div>
            </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-between text-white-black" >
            <span 
                className="text-center text-meta text-gray-500"
                >
                <kbd
                  className="ml-[1] text-white-black p-1 px-2 bg-taskDetailPage border-[1px] dark:border-none border-icon-hover-gray "
                    
                    >↑
                </kbd>
                <kbd
                  className="mx-[1px] p-1 px-2 text-white-black  rounded  font-medium bg-taskDetailPage border-[1px] dark:border-none border-icon-hover-gray "
                    
                    >↓
                </kbd>
                    to navigate
                </span>
            <span
              className="text-right text-meta"
                >
                <kbd
                  className="rounded bg-taskDetailPage border-[1px] border-icon-hover-gray dark:border-none text-white-black p-1 mr-[1px] px-[1.5px]"
                    
                    >
                        Enter
                </kbd> 
                    to select
            </span>
        </div>
      </div>
    ) : null;
  }
);

CommandsList.displayName = "CommandsList";

export default CommandsList;
