import { debounceWithCancel } from "@/utils/helperFunctions/helperFunctions";

const { useRef, useMemo, useEffect } = require("react");
const useDebounceWithCancel = (callback, waitTime, flushOnUnmount = false) => {
    const ref = useRef();
  
    useEffect(() => {
      ref.current = callback;
    }, [callback]);
  
    const [debouncedCallback, cancel, flush] = useMemo(() => {
      const func = (...args) => {
        ref.current?.(...args);
      };
      return debounceWithCancel(func, waitTime);
    }, [waitTime]);

    useEffect(
      () => {
        if (!flushOnUnmount) return;
        return () => flush();
      },
      [flush, flushOnUnmount]
    );
  
    return [debouncedCallback, cancel, flush];
  };
  
  export default useDebounceWithCancel
