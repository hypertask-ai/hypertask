import { useAITaskWriterContext } from "@/lib/contexts/TaskDetail/AITaskWriterContext";
import { FC } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";


interface ResponseNavigatorProps {
    currentIndex: number;
    totalResponses: number;
    onNavigate: (index: number) => void;
    onAccept: () => void;
}

const ResponseNavigator: FC<ResponseNavigatorProps> = ({
    currentIndex,
    totalResponses,
    onNavigate,
    onAccept
}) => {
    const { isLoading} = useAITaskWriterContext()
    if (totalResponses <=1) return null;
    const displayIndex = currentIndex + 1;
    const isViewingLatest = currentIndex === totalResponses - 1 || currentIndex >= totalResponses;
    const canGoBack = currentIndex > 0;
    const canGoForward = currentIndex < totalResponses - 1;

    const handlePrevious = () => {
        if (currentIndex > 0) {
            onNavigate(currentIndex - 1);
        }
    };

    const handleNext = () => {
        if (currentIndex < totalResponses - 1) {
            onNavigate(currentIndex + 1);
        }
    };

    return (
        <div className="flex items-center justify-between pb-1 text-content">
            <div className="flex items-center text-gray-400">
                <button
                    onClick={handlePrevious}
                    disabled={!canGoBack || isLoading}
                    className="hover:text-white disabled:opacity-30 disabled:cursor-not-allowed mx-1"
                >
                    <ChevronLeft size={18}  strokeWidth={1.75}/>
                </button>

                <span className="font-mono  text-center">
                    {displayIndex}/{totalResponses}
                </span>

                <button
                    onClick={handleNext}
                    disabled={!canGoForward || isLoading}
                    className="hover:text-white disabled:opacity-30 disabled:cursor-not-allowed mx-1"
                >
                    <ChevronRight size={18}  strokeWidth={1.75}/>
                </button>
            </div>
            {/*       
      <button 
        onClick={onAccept}
        className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-meta text-white transition-colors"
      >
        Accept
      </button> */}
        </div>
    );
};

export default ResponseNavigator;
