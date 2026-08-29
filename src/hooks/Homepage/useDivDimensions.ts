// useDivDimensions.js
import { useEffect, useState } from 'react';

const useDivDimensions = (divId:string) => {
    const [dimensions, setDimensions] = useState({ scrollWidth: 0, clientWidth: 0 });
    const div = document.getElementById(divId);

    useEffect(() => {

        if (div) {
            const updateDimensions = () => {
                setDimensions({
                    scrollWidth: div.scrollWidth,
                    clientWidth: div.clientWidth,
                });
            };

            const observer = new MutationObserver(updateDimensions);
            observer.observe(div, { childList: true, subtree: true });
            window.addEventListener('resize', updateDimensions);

            // Initial call
            updateDimensions();

            return () => {
                observer.disconnect();
                window.removeEventListener('resize', updateDimensions);
            };
        }
    }, [divId,div]);

    return dimensions;
};

export default useDivDimensions;
