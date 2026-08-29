export default function FullScreenChatLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex h-screen w-full items-center justify-center bg-ai-chat text-text-light-gray"
    >
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className="sr-only">Loading AI chat</span>
    </main>
  );
}
