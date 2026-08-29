import React, { useRef, useState, useEffect } from 'react';

const useSetStickyHeight = () => {
  const [dynamicTopValue, setDynamicTopValue] = useState(0);
  const dynamicElementRef = useRef<any>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const setStickyElementHeight = () => {
    // Use the ref instead of getElementById to avoid conflicts with multiple instances
    const title_containerEl = dynamicElementRef.current;
    const dynamicElementHeight = title_containerEl?.offsetHeight;
    dynamicElementHeight && setDynamicTopValue(dynamicElementHeight);
  };

  useEffect(() => {
    // Use the ref instead of getElementById to avoid conflicts with multiple instances
    const title_containerEl = dynamicElementRef.current;

    if (!title_containerEl) return;

    observerRef.current = new ResizeObserver(() => {
      setStickyElementHeight();
    });

    observerRef.current.observe(title_containerEl);

    // Cleanup on unmount
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  return { setStickyElementHeight, dynamicTopValue, dynamicElementRef };
};

export default useSetStickyHeight;
