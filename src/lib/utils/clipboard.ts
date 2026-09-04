// Plain-text clipboard writes can be unavailable or blocked in mobile and in-app
// browsers, so use the legacy browser path before reporting failure.
export const writeTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.error("clipboard.writeText failed, falling back:", err);
  }

  try {
    const textarea = document.createElement("textarea");
    try {
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  } catch (err) {
    console.error("execCommand copy fallback failed:", err);
    return false;
  }
};
