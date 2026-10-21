import React from "react";

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
