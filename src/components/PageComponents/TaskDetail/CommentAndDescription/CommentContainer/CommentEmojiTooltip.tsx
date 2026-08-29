import Tooltip from '@/components/Common/Tooltip'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ShortcutTooltip = ({ text, shortcut }: { text: string; shortcut: string }) => (
    <div className="hidden sm:flex items-center z-[9999] font-semibold border-light-black-border-1 border-[1px] bg-labelComponent gap-2 py-[6px] px-2 whitespace-nowrap text-dense xl:text-content rounded-[4px]">
        <span className="text-black">{text}</span>
        <kbd className="px-1 pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64] dark:border-gray-500">
            {shortcut}
        </kbd>
    </div>
)

const CommentEmojiTooltip = ({ anchorElement = null }: { anchorElement?: HTMLElement | null }) => {
    const portalRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState({ left: 0, top: 0 })

    useEffect(() => {
        if (!anchorElement) return
        const updatePosition = () => {
            const anchorRect = anchorElement.getBoundingClientRect()
            const tooltipRect = portalRef.current?.getBoundingClientRect()
            const width = tooltipRect?.width ?? 0
            const height = tooltipRect?.height ?? 70
            const composerTop = document.getElementById('comment')?.getBoundingClientRect().top
            const lowerBoundary = composerTop ?? window.innerHeight
            const showAbove = anchorRect.bottom + 8 + height > lowerBoundary
            setPosition({
                left: Math.max(0, Math.min(anchorRect.left, window.innerWidth - width)),
                top: Math.max(0, showAbove ? anchorRect.top - height - 8 : anchorRect.bottom + 8),
            })
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

export default CommentEmojiTooltip
