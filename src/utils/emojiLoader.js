import { lazy, Suspense } from 'react';

let emojiDataPromise = null;
let emojiPickerPromise = null;
let emojiSyncTimer = null;

const persistFrequentEmojis = () => {
  if (typeof window === 'undefined') return;
  if (emojiSyncTimer) clearTimeout(emojiSyncTimer);
  emojiSyncTimer = setTimeout(() => {
    try {
      const raw = window.localStorage.getItem('emoji-mart.frequently');
      if (!raw) return;
      const map = JSON.parse(raw);
      if (!map || typeof map !== 'object') return;
      fetch('/api/users/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emojiFrequency: map }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, 800);
};

export const loadEmojiData = () => {
  if (!emojiDataPromise) {
    emojiDataPromise = import('@emoji-mart/data').then(module => module.default);
  }
  return emojiDataPromise;
};

export const loadEmojiPicker = () => {
  if (!emojiPickerPromise) {
    emojiPickerPromise = import('@emoji-mart/react').then(module => module.default);
  }
  return emojiPickerPromise;
};

export const preloadEmojiResources = () => {
  loadEmojiData();
  loadEmojiPicker();
};

const resolveAppTheme = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';

export const LazyEmojiPickerRaw = lazy(() =>
  Promise.all([loadEmojiPicker(), loadEmojiData()])
    .then(([Picker, data]) => ({
      default: (props) => {
        const handleSelect = (emoji, e) => {
          try {
            props.onEmojiSelect?.(emoji, e);
          } finally {
            persistFrequentEmojis();
          }
        };
        return (
          <Picker
            theme={resolveAppTheme()}
            {...props}
            data={data}
            onEmojiSelect={handleSelect}
          />
        );
      }
    }))
);

export const LazyEmojiPicker = (props) => (
  <Suspense fallback={null}>
    <LazyEmojiPickerRaw {...props} />
  </Suspense>
);
