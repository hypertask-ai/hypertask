import { cn } from "@/utils/undoActions/helperFuncs";

const KBDElement = ({
  content,
  className,
}: {
  content: string;
  className?: string;
}) => {
  return (
    <kbd
      className={cn(
        `px-2 font-bold text-content pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64]  dark:border-gray-500`,
        className
      )}
    >
      {content}
    </kbd>
  );
};

export default KBDElement;
