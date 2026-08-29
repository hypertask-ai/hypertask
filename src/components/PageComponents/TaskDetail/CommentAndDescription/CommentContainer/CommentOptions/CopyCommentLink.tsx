import React from 'react';
import { useMemo } from 'react';
import { Pencil, Link } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs"

import toast from 'react-hot-toast';

interface IProps {
    // onClickHandler :(currentIndex: number) => void;
    currentIndex: number;
    href:string
}

const CopyCommentLink: React.FC<IProps> = ({ currentIndex, href }) => {
    const className = useMemo(() => "cursor-pointer fill-icon-dark-gray hover:fill-white-black transition-[transform,fill] ease-in-out duration-100 scale-0 group-hover:scale-100 rounded-lg xs:mb-[5px] sm:mb-0", [])

    const onClick = (e: any) => {
        e.stopPropagation()
        const currentURL = href; // Get the current page URL
        navigator.clipboard.writeText(currentURL + `#comment-${currentIndex}`) // Copy it to the clipboard
        toast("Link to this comment copied to clipboard!")
    }
    return (
        // <div className={cn(className,"")}>
        <Link size={14} onClick={onClick} strokeWidth={1.75} className={cn(className, 'text-content text-white-black')} />
        // </div>
    )
}

export default CopyCommentLink
