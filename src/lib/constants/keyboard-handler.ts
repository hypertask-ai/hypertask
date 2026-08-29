// keyboard-handler.ts

/**
 * Keyboard key codes mapping
 * Note: keyCode is deprecated in favor of KeyboardEvent.key and KeyboardEvent.code
 * but still widely used for compatibility
 */
export const KeyCodes = {
  // Letters (uppercase values - will work for both cases in keydown/keyup)
  A: 65,
  B: 66,
  C: 67,
  D: 68,
  E: 69,
  F: 70,
  G: 71,
  H: 72,
  I: 73,
  J: 74,
  K: 75,
  L: 76,
  M: 77,
  N: 78,
  O: 79,
  P: 80,
  Q: 81,
  R: 82,
  S: 83,
  T: 84,
  U: 85,
  V: 86,
  W: 87,
  X: 88,
  Y: 89,
  Z: 90,

  // Numbers (top row)
  ZERO: 48,
  ONE: 49,
  TWO: 50,
  THREE: 51,
  FOUR: 52,
  FIVE: 53,
  SIX: 54,
  SEVEN: 55,
  EIGHT: 56,
  NINE: 57,

  // Numpad
  NUMPAD_0: 96,
  NUMPAD_1: 97,
  NUMPAD_2: 98,
  NUMPAD_3: 99,
  NUMPAD_4: 100,
  NUMPAD_5: 101,
  NUMPAD_6: 102,
  NUMPAD_7: 103,
  NUMPAD_8: 104,
  NUMPAD_9: 105,
  NUMPAD_MULTIPLY: 106,
  NUMPAD_ADD: 107,
  NUMPAD_SUBTRACT: 109,
  NUMPAD_DECIMAL: 110,
  NUMPAD_DIVIDE: 111,

  // Function keys
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,

  // Navigation
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,
  PAGE_UP: 33,
  PAGE_DOWN: 34,
  HOME: 36,
  END: 35,

  // Special keys
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  PAUSE_BREAK: 19,
  CAPS_LOCK: 20,
  ESCAPE: 27,
  SPACE: 32,
  DELETE: 46,
  INSERT: 45,
  
  // Windows key / Command key
  META_LEFT: 91,
  META_RIGHT: 93,
  WINDOWS: 91,
  COMMAND: 91,

  // Context Menu key
  CONTEXT_MENU: 93,

  // Punctuation and symbols
  // Note: These can vary between browsers and keyboard layouts
  SEMICOLON: 186,     // ; :
  EQUALS: 187,        // = +
  COMMA: 188,         // , <
  MINUS: 189,         // - _
  PERIOD: 190,        // . >
  FORWARD_SLASH: 191, // / ?
  BACKTICK: 192,      // ` ~
  OPEN_BRACKET: 219,  // [ {
  BACKSLASH: 220,     // \ |
  CLOSE_BRACKET: 221, // ] }
  SINGLE_QUOTE: 222,  // ' "
} as const;

// Type for the key codes
export type KeyCode = typeof KeyCodes[keyof typeof KeyCodes];

export const KeyValues = {
  // Letters
  A: ['a', 'A'],
  B: ['b', 'B'],
  C: ['c', 'C'],
  D: ['d', 'D'],
  E: ['e', 'E'],
  F: ['f', 'F'],
  G: ['g', 'G'],
  H: ['h', 'H'],
  I: ['i', 'I'],
  J: ['j', 'J'],
  K: ['k', 'K'],
  L: ['l', 'L'],
  M: ['m', 'M'],
  N: ['n', 'N'],
  O: ['o', 'O'],
  P: ['p', 'P'],
  Q: ['q', 'Q'],
  R: ['r', 'R'],
  S: ['s', 'S'],
  T: ['t', 'T'],
  U: ['u', 'U'],
  V: ['v', 'V'],
  W: ['w', 'W'],
  X: ['x', 'X'],
  Y: ['y', 'Y'],
  Z: ['z', 'Z'],

  // Special keys
  ENTER: ['Enter'],
  SPACE: [' '],
  TAB: ['Tab'],
  DELETE: ['Delete'],
  BACKSPACE: ['Backspace'],
  ESCAPE: ['Escape', 'Esc'],
  ARROW_UP: ['ArrowUp'],
  ARROW_DOWN: ['ArrowDown'],
  ARROW_LEFT: ['ArrowLeft'],
  ARROW_RIGHT: ['ArrowRight'],
  SHIFT: ['Shift'],
  CONTROL: ['Control'],
  ALT: ['Alt'],
  META: ['Meta'],
} as const;

// Helper type for key names
export type KeyName = keyof typeof KeyCodes;
export type KeyValueName = keyof typeof KeyValues;

function isKeyPressed(
    e: KeyboardEvent,
    key: keyof typeof KeyValues
): boolean {
    return (KeyValues[key] as readonly string[]).includes(e.key);
}

