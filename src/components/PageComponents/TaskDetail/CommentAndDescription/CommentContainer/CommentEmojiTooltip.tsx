import { useFlag } from "@/hooks/useFlag";
import { HTPR_6950_TOOLTIP_TOP_LAYER_FLAG } from "@/lib/flags/keys";
import { createPortal } from "react-dom"
import Tooltip from '@/components/Common/Tooltip'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import TooltipPortal from '@/components/Common/TooltipPortal'

const ShortcutTooltip = ({ text, shortcut, topLayer = false }: { text: string; shortcut: string; topLayer?: boolean }) => (
    <div className={`hidden sm:flex items-center ${topLayer ? "" : "z-[9999]"} font-semibold border-light-black-border-1 border-[1px] bg-labelComponent gap-2 py-[6px] px-2 whitespace-nowrap text-dense xl:text-content rounded-[4px]`}>
        <span className="text-black">{text}</span>
        <kbd className="px-1 pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64] dark:border-gray-500">
            {shortcut}
        </kbd>
    </div>
)

const getReactionTooltipPosition = (anchorElement: HTMLElement, tooltipElement: HTMLDivElement | null) => {
    const anchorRect = anchorElement.getBoundingClientRect()
    const tooltipRect = tooltipElement?.getBoundingClientRect()
    const width = tooltipRect?.width ?? 0
    const height = tooltipRect?.height ?? 70
    const composerTop = document.getElementById('comment')?.getBoundingClientRect().top
    const lowerBoundary = composerTop ?? window.innerHeight
    const showAbove = anchorRect.bottom + 8 + height > lowerBoundary
    return {
        left: Math.max(0, Math.min(anchorRect.left, window.innerWidth - width)),
        top: Math.max(0, showAbove ? anchorRect.top - height - 8 : anchorRect.bottom + 8),
    }
}

const LegacyCommentEmojiTooltip = ({ anchorElement = null }: { anchorElement?: HTMLElement | null }) => {
    const portalRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState({ left: 0, top: 0 })

    useEffect(() => {
        if (!anchorElement) return
        const updatePosition = () => {
            setPosition(getReactionTooltipPosition(anchorElement, portalRef.current))
        }
        updatePosition()
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)
        return () => {
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [anchorElement])

    if (anchorElement && typeof document !== 'undefined') {
        return createPortal(
            <div ref={portalRef} className="fixed z-[9999] flex flex-col gap-[5px]" style={position}>
                <ShortcutTooltip text="Add Reaction" shortcut="R" />
                <ShortcutTooltip text="Fast Like" shortcut="L" />
            </div>,
            document.body
        )
    }

    return (
        <>
            <Tooltip
                left={0}
                bottom={-40}
                keyCombination={["R"]}
                text={"Add Reaction"}
            />
            <Tooltip
                left={0}
                bottom={-75}
                keyCombination={["L"]}
                text={"Fast Like"}
            />
        </>
    )
}

const TopLayerCommentEmojiTooltip = ({ anchorElement = null }: { anchorElement?: HTMLElement | null }) => {
    const portalRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState({ left: 0, top: 0 })

    const updatePosition = useCallback(() => {
        if (anchorElement) setPosition(getReactionTooltipPosition(anchorElement, portalRef.current))
    }, [anchorElement])

    if (anchorElement && typeof document !== 'undefined') {
        return (
            <TooltipPortal placement="fixed" anchorElement={anchorElement} onPosition={updatePosition}>
                <div ref={portalRef} className="fixed flex flex-col gap-[5px]" style={position}>
                    <ShortcutTooltip topLayer text="Add Reaction" shortcut="R" />
                    <ShortcutTooltip topLayer text="Fast Like" shortcut="L" />
                </div>
            </TooltipPortal>
        )
    }

    return (
        <TooltipPortal hover placement="trigger">
            <div className="absolute flex flex-col gap-[5px]" style={{ left: 0, top: 'calc(100% + 8px)' }}>
                <ShortcutTooltip topLayer text="Add Reaction" shortcut="R" />
                <ShortcutTooltip topLayer text="Fast Like" shortcut="L" />
            </div>
        </TooltipPortal>
    )
}

const CommentEmojiTooltip = (props: { anchorElement?: HTMLElement | null }) => {
  const topLayer = useFlag(HTPR_6950_TOOLTIP_TOP_LAYER_FLAG);
  return topLayer ? <TopLayerCommentEmojiTooltip {...props} /> : <LegacyCommentEmojiTooltip {...props} />;
};

export default CommentEmojiTooltip;
