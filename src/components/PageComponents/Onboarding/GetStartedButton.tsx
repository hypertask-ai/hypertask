interface IButton {
  onClick: () => void;
  text: string;
  disabled?: boolean;
}

export const GetStartedButton: React.FC<IButton> = ({
  onClick,
  text,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      className={`py-2 sm:py-3 font-semibold rounded px-5 sm:px-6 bg-kanban-active-cardbg text-content sm:text-emphasis min-w-[120px] hover:opacity-90 transition-opacity duration-200 ${
        disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
      }`}
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
    >
      {text}
    </button>
  );
};
