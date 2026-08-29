import { useRef } from "react";

interface Props {
    setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
    setHoveredIndex?: React.Dispatch<React.SetStateAction<number | null>>
    preserveSelectedIndexOnHover?: boolean
}
const useHandleMouseGlobal = ({
    setSelectedIndex,
    setHoveredIndex,
    preserveSelectedIndexOnHover = false,
}: Props) => {
    const elRef = useRef<HTMLDivElement>(null);


    const currentHoveredDiv = useRef<number | null>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = (index: number) => {
        currentHoveredDiv.current = index;
        setHoveredIndex?.(index);
    };

    const handleMouseLeave = () => {
        currentHoveredDiv.current = null;
        setHoveredIndex?.(null);
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }

        // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
        debounceTimeout.current = setTimeout(() => {
            if (currentHoveredDiv.current === null && elRef.current) {
                (elRef.current as HTMLDivElement)?.blur();
            }
        }, 100);
    };

    const handleMouseMove = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            if (!preserveSelectedIndexOnHover && currentHoveredDiv.current !== null) {
                setSelectedIndex(currentHoveredDiv.current)
            }
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    };

    return{
        handleMouseMove,handleMouseLeave,handleMouseEnter,elRef
    }

}

export default useHandleMouseGlobal;
