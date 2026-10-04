export default function FullScreenChatLoading({
  label = "Loading AI chat",
  inline = false,
}: { label?: string; inline?: boolean } = {}) {
  return (
    <main
      role="status"
      aria-live="polite"
      className={inline
        ? "flex min-h-32 w-full items-center justify-center gap-6 text-text-light-gray"
        : "flex h-screen w-full items-center justify-center bg-ai-chat text-text-light-gray"}
    >
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className={inline ? "text-content" : "sr-only"}>{label}</span>
    </main>
  );
}
