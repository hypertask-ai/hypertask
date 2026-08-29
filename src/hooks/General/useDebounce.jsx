import { debounce } from "@/utils/helperFunctions/helperFunctions";

const { useRef, useMemo, useEffect } = require("react");
const useDebounce = (callback, waitTime) => {
    const ref = useRef();
  
    useEffect(() => {
      ref.current = callback;
    }, [callback]);
  
    const debouncedCallback = useMemo(() => {
      const func = () => {
        ref.current?.();
      };
  
      return debounce(func, waitTime);
    }, [waitTime]);
  
    return debouncedCallback;
  };

  export default useDebounce