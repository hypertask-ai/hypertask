import { CircleArrowUp } from "lucide-react";

const UpgradeToAi = () => {
  return (
    <div tabIndex={0} className="hidden font-medium sm:flex items-center">
      <>
        <CircleArrowUp color="#4455BB" className="mr-2" strokeWidth={1.75} />
        <span className="text-emphasis sm:text-content text-white-black">
          Upgrade to add
        </span>
        <span className="text-[#4455BB] sm:text-emphasis text-content ml-1">
          AI
        </span>
      </>
    </div>
  );
};

export default UpgradeToAi;
