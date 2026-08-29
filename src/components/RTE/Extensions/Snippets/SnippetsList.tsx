import type { ISnippet } from "@/lib/snippets";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

export type SnippetsListRef = {
  onKeyDown: NonNullable<
    ReturnType<NonNullable<SuggestionOptions["render"]>>["onKeyDown"]
  >;
};

const getPreview = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SnippetsList = forwardRef<SnippetsListRef, SuggestionProps>(
  (props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [items, setItems] = useState<ISnippet[]>(props.items as ISnippet[]);

    useEffect(() => {
      if (!props.items) return;
      setItems(props.items as ISnippet[]);
      setSelectedIndex(0);
    }, [props.items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) props.command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          if (items.length)
            setSelectedIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          if (items.length) setSelectedIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          if (!items.length) return false;
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    return (
      // Same shell as the slash-command menu: shadow only, never a border, and
      // literal hex for the dark background (the popup is portaled to <body>).
      <div className="rounded-md shadow-xl dark:bg-[#333B47] bg-[#ffffff] flex flex-col p-2 gap-2 min-w-[280px] max-w-[420px]">
        <ul className="max-h-72 no-scrollbar scrollbar-none overflow-y-auto gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectItem(index);
              }}
              className={`cursor-pointer text-content p-2 ${
                index === selectedIndex
                  ? "bg-[#ececec] dark:bg-[#4f5766]"
                  : "transparent"
              } rounded-md py-1`}
            >
              <div className="px-1">
                <h3 className="truncate text-content text-white-black">
                  {item.title}
                </h3>
                <span className="block truncate text-meta text-gray-400">
                  {getPreview(item.content)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-between text-white-black">
          <span className="text-center text-meta text-gray-500">
            <kbd className="ml-[1] text-white-black p-1 px-2 bg-taskDetailPage border-[1px] dark:border-none border-icon-hover-gray">
              ↑
            </kbd>
            <kbd className="mx-[1px] p-1 px-2 text-white-black rounded font-medium bg-taskDetailPage border-[1px] dark:border-none border-icon-hover-gray">
              ↓
            </kbd>
            to navigate
          </span>
          <span className="text-right text-meta">
            <kbd className="rounded bg-taskDetailPage border-[1px] border-icon-hover-gray dark:border-none text-white-black p-1 mr-[1px] px-[1.5px]">
              Enter
            </kbd>
            to select
          </span>
        </div>
      </div>
    );
  },
);

SnippetsList.displayName = "SnippetsList";

export default SnippetsList;
