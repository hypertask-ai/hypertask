// File: /utils/emojiLoader.js
import { lazy, Suspense } from 'react';

// Module-level cache to track loading state
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
      // fire-and-forget; server derives userId from cookie
      fetch('/api/users/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emojiFrequency: map }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, 800);
};

/**
 * Singleton loader that ensures emoji data is only loaded once across the application
 * @returns {Promise} Promise that resolves when emoji data is loaded
 */
export const loadEmojiData = () => {
  if (!emojiDataPromise) {
    // Start the loading process only once
    emojiDataPromise = import('@emoji-mart/data').then(module => module.default);
  }
  return emojiDataPromise;
};

/**
 * Singleton loader for emoji picker component
 * @returns {Promise} Promise that resolves when emoji picker is loaded
 */
export const loadEmojiPicker = () => {
  if (!emojiPickerPromise) {
    emojiPickerPromise = import('@emoji-mart/react').then(module => module.default);
  }
  return emojiPickerPromise;
};

/**
 * Preloads emoji resources in the background
 * Can be called from app initialization or on user interaction
 */
export const preloadEmojiResources = () => {
  // Load in background without awaiting
  loadEmojiData();
  loadEmojiPicker();
};

// emoji-mart defaults to theme="auto", which follows the OS colour scheme and
// ignores our cookie-driven app theme — a light picker lands on a dark app (and
// vice-versa). Resolve from the app's own theme class instead. dark/amoled carry
// `dark`; light/dia carry `light`, so this maps every app theme to the two the
// picker supports. An explicit `theme` prop still wins.
const resolveAppTheme = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';

// Lazy-loaded component that shares the same data instance.
// Raw lazy export: suspends the CALLER's boundary. Only for call sites that
// provide their own Suspense with visible loading UI (EmojiGifPicker).
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

// Ships with its own Suspense boundary: every usage site portals this straight
// into #portal-root with no local boundary, so on first open the load would
// suspend the nearest ancestor. On mobile that is the route-level boundary,
// which blanks the whole task page and destroys the scroll position (HTPR-4584).
export const LazyEmojiPicker = (props) => (
  <Suspense fallback={null}>
    <LazyEmojiPickerRaw {...props} />
  </Suspense>
);
