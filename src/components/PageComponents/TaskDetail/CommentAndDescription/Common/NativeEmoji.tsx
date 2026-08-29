import React from "react";

// Renders a single emoji natively from its unified codepoint(s), e.g.
// "1f600" or the ZWJ sequence "1f469-200d-1f4bb". Replaces emoji-picker-react's
// <Emoji /> so we ship one emoji library (@emoji-mart, whose picker is also native).
const emojiFont =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const NativeEmoji = ({ unified, size }: { unified: string; size: number }) => {
  const native = unified
    .split("-")
    .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
    .join("");
  return (
    <span
      style={{ fontSize: size, lineHeight: 1, fontFamily: emojiFont }}
      aria-hidden="true"
    >
      {native}
    </span>
  );
};

export default NativeEmoji;
