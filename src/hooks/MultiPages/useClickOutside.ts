import { useEffect, MutableRefObject } from 'react';

const useClickOutside = (ref: MutableRefObject<HTMLElement | null> | null, callback: () => void, id?: string) => {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      const element = ref?.current || (id ? document.getElementById(id) : null);
      const openModal = document.querySelector('.modal.show');

      // A different modal layered on top should suppress this outside click.
      // But if the tracked element IS the open modal, this is that modal's
      // own click-outside-to-close and must not be blocked (HTPR-5139).
      if (openModal && !(element && openModal.contains(element))) {
        return;
      }

      if (element && !element.contains(event.target as Node)) {
        callback();
      }
    };

    const outsideEvent = window.PointerEvent ? 'pointerdown' : 'mousedown';
    document.addEventListener(outsideEvent, handleClickOutside);
    return () => {
      document.removeEventListener(outsideEvent, handleClickOutside);
    };
  }, [ref, callback, id]);

};

export default useClickOutside;
