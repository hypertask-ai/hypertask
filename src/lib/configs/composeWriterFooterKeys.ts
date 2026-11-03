export type ComposeFooterKey = readonly [keys: string, action: string];

export type ComposeFooterKeys = {
  left: readonly ComposeFooterKey[];
  right: readonly ComposeFooterKey[];
};

export type ComposeFooterState = {
  recording: boolean;
  transcribing: boolean;
  commandKey: string;
  board: boolean;
  dictate: boolean;
  ctrlEnterSends: boolean;
};

export function composeWriterFooterKeys({ recording, transcribing, commandKey, board, dictate, ctrlEnterSends }: ComposeFooterState): ComposeFooterKeys {
  const boardKey: ComposeFooterKey = [`${commandKey} Shift B`, "board"];
  const attachKey: ComposeFooterKey = [`${commandKey} U`, "attach"];
  const closeKey: ComposeFooterKey = ["Esc", "close"];
  const createKey: ComposeFooterKey = [ctrlEnterSends ? `${commandKey} Enter` : "Enter", "create"];
  const lineKey: ComposeFooterKey = ctrlEnterSends ? ["Enter", "new line"] : ["Shift Enter", "new line"];
  const dictateKey: ComposeFooterKey = [`${commandKey} Shift D`, "dictate"];
  const stopKey: ComposeFooterKey = [`${commandKey} Shift D`, "stop"];
  if (recording) {
    return {
      left: [["Enter", "keep text"], createKey, ["Esc", "cancel"]],
      right: dictate ? [stopKey] : [],
    };
  }
  if (transcribing) return { left: [closeKey], right: [] };
  return {
    left: [
      createKey,
      lineKey,
      closeKey,
      ...(board ? [boardKey] : []),
      attachKey,
    ],
    right: dictate ? [dictateKey] : [],
  };
}
