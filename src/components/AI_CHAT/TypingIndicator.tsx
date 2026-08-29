import { FC } from "react";

export const TypingIndicator: FC = () => {
  return (
    <div
      className="flex items-center space-x-1"
      role="status"
      aria-label="AI is thinking"
    >
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-500 dark:bg-gray-400"
        style={{ animationDelay: "0ms" }}
        aria-hidden="true"
      />
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-500 dark:bg-gray-400"
        style={{ animationDelay: "300ms" }}
        aria-hidden="true"
      />
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-gray-500 dark:bg-gray-400"
        style={{ animationDelay: "600ms" }}
        aria-hidden="true"
      />
    </div>
  );
};
