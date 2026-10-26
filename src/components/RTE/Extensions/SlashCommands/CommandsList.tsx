
import { currentProjectAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7879_SKILL_MENU_FLAG } from "@/lib/flags/definitions/htpr-7879-skill-menu";
import { HTPR_7480_COMMENT_SKILL_RUN_FLAG, HTPR_7393_COMMENT_INLINE_AI_FLAG } from "@/lib/flags/keys";
import { AI_TASK_WRITER_EVENT } from "@/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton";
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

const COMMENT_SKILL_MODE = "create-comment";
const AGENT_CHAT_SKILL_MODE = "ai-chat";

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
    const projectSkills = useFlag(HTPR_7879_SKILL_MENU_FLAG);
    const getProjectId = (props.editor?.storage as any)?.slashCommands?.getProjectId as
      | (() => number | null | undefined)
      | undefined;
    const projectId = projectSkills && getProjectId ? getProjectId() : currentProject?.id;
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [skillItems, setSkillItems] = useState<SkillSlashItem[]>([]);
    const mode = (props.editor?.storage as any)?.slashCommands?.mode as
      | string
      | undefined;
    const commentSkillRun = useFlag(HTPR_7480_COMMENT_SKILL_RUN_FLAG);
    const commentInlineAi = useFlag(HTPR_7393_COMMENT_INLINE_AI_FLAG);
    const runCommentSkill = commentSkillRun && commentInlineAi &&
      (mode === COMMENT_SKILL_MODE || mode === "read-edit-comments");
    const skillsEnabled =
      mode === COMMENT_SKILL_MODE ||
      mode === AGENT_CHAT_SKILL_MODE ||
      runCommentSkill;
    const everHadBase = useRef(false);
    const lastBase = useRef<any[]>([]);
    if ((props.items?.length ?? 0) > 0) everHadBase.current = true;

    useEffect(() => {
      if (!skillsEnabled) {
        setSkillItems([]);
        return;
      }
      let cancelled = false;
      fetchSlashSkills(projectId).then((skills) => {
        if (!cancelled) setSkillItems(buildSkillSlashItems(skills));
      });
      return () => {
        cancelled = true;
      };
    }, [skillsEnabled, projectId]);
  
    const [filteredItems, setFilteredItems] = useState(props.items)
    const selectItem = (index: number) => {
      if (index >= filteredItems.length) {
        return;
      }

      const command = {
        ...filteredItems[index],
        currentProjectId: projectId,
      };

      if (runCommentSkill && command.type === "SKILL") {
        const targetId = (props.editor.storage as any)?.slashCommands?.editorId as string | undefined;
        if (targetId) {
          props.editor.chain().focus().deleteRange(props.range).run();
          window.dispatchEvent(new window.CustomEvent(AI_TASK_WRITER_EVENT, {
            detail: { targetId, prompt: `${command.title} ` },
          }));
          return;
        }
      }
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
      const currentBase = props.items ?? [];
      const baseIsLoadingPlaceholder =
        currentBase.length === 0 && everHadBase.current;
      if (baseIsLoadingPlaceholder && skillItems.length === 0) return;
      const base = baseIsLoadingPlaceholder ? lastBase.current : currentBase;
      if (!baseIsLoadingPlaceholder) lastBase.current = currentBase;
      const normalizedQuery = props.query.toLowerCase();
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
