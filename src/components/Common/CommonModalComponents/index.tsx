import { cn } from "@/utils/undoActions/helperFuncs";
import { forwardRef, useEffect, useRef } from "react";
import { Modal, ModalFooter, ModalHeader } from "reactstrap";
import styles from '@/styles/linksModal.module.scss'
import { ICustomModalContainerProps, IModalHeaderProps, IModalInputProps, IModalListContainerProps, IModalRowProps } from "@/models/CustomModals";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";


export const ModalContainerCustom: React.FC<ICustomModalContainerProps> = ({
  isOpen,
  onOpened,
  toggle,
  className,
  children,
  contentClassName,
  fade = false,
  id = "MoveModal",
  style = {},
  autoFocus = false,
  show = true,
  backdrop = true,
  shouldCloseOnClickOutside = false,
  keyboard = true,
  forceRenderOnlyChildren = false,
  fullScreen = false,
  trapFocus = false,
  scrollable = false,
  legacySizing = false,
  ...props
}) => {
  const modalRef = useRef<any>(null)
  const handleClickOutside = () => {
    if (!shouldCloseOnClickOutside) return
    toggle()
  };
  useClickOutside(null, handleClickOutside, id);

  return (
    <>
      {
        forceRenderOnlyChildren ?
          <>{children}</>
          :
          <Modal
            fullscreen={fullScreen}
            fade={fade}
            id={id}
            ref={modalRef}
            contentClassName={cn(
              "[--bs-modal-padding:1.5rem]",
              contentClassName,
            )}
            style={{ ...style }}
            isOpen={isOpen}
            show={show}
            onOpened={onOpened}
            autoFocus={autoFocus}
            trapFocus={trapFocus}
            toggle={toggle}
            keyboard={keyboard}
            backdrop={backdrop}
            {...props}
            className={cn(`${legacySizing ? "legacyModalSizing" : ""} p-0 customshadow-4 bg-modalBackground text-white-black rounded-[5px] my-0 flex shadow-customshadow-2
            items-center justify-center linksModal mx-auto 
            ${fullScreen ? "" : "sm:min-w-[560px] xs:max-h-[600px] xs:top-[env(safe-area-inset-top)] sm:top-[180px]  sm:max-h-full"}
             min-w-full   ${styles.links_modal}`, className)}
          >
            {children}
          </Modal>
      }
    </>

  );
};


export const ModalFooterComp: React.FC<React.HTMLAttributes<HTMLElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <ModalFooter
      {...props}
      className={cn("border-none gap-2 mt-2 px-6", className)}
    >
      {children}
    </ModalFooter>
  )
}

export const ModalHeaderComp: React.FC<IModalHeaderProps> = ({
  children,
  header,
  className,
  headerClassName,
  fullscreen = false,
  subHeadline,
  subHeadlineClassName,
  shouldShowSeparator,
  ...props
}) => {
  return (
    <ModalHeader
      data-common-modal-header
      {...props}
      className={cn(`border-transparent bg-inherit rounded-tl-sm rounded-tr-sm font-medium px-6 py-0
        ${fullscreen ? "" : "h-[48px]"}
        text-emphasis` , className)}>
      <div data-common-modal-header-inner className={cn("grid w-full items-end gap-2 h-[48px] border-transparent font-medium py-[8px]",headerClassName)}>
        <div className="flex items-center justify-between">
          <span className="modal-title font-medium w-full  ">
            {header}
          </span>
          {children}
        </div>
        {
          subHeadline && <span className={cn("text-emphasis font-normal", subHeadlineClassName)}>{subHeadline}</span>
        }
        <hr className={`${!shouldShowSeparator && "hidden"} h-[1px] w-full`} />
      </div>
    </ModalHeader>
  )
}

// ======================== modal input
export const ModalInput = forwardRef<HTMLInputElement, IModalInputProps>(({
  value,
  onKeyDown,
  id,
  autofocus=true,
  className,
  ...props // Spread the rest of the props
}, ref) => {
  return (
    <input
      ref={ref}
      data-common-modal-input
      id={id}
      autoFocus={autofocus}
      onBlur={() => id && document.getElementById(id)?.focus()}
      className={cn("h-[44px] py-2 px-6 text-content xs:text-content sm:text-content w-full bg-inherit border-0 outline-none font-normal min-w-0 text-white-black placeholder:text-text-light-gray", className)}
      value={value}
      // A command/search box, never a credential field. type=search plus these
      // stops the mobile keyboard's password / credit-card / contact autofill
      // strip (autoComplete="off" alone is ignored by iOS); the data-* opt-outs
      // silence desktop password-manager extensions.
      type="search"
      inputMode="search"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      onKeyDown={onKeyDown}
      style={{ overflowX: "auto", overflowY: "hidden" }}
      {...props}
    />
  )
})

ModalInput.displayName = "ModalInput";

// ==================== model list container
export const ModalListContainer: React.FC<IModalListContainerProps> = ({
  children,
  id,
  className,
  handleMouseMove,
  ...props
}) => {
  return (
    <ul
      {...props}
      onMouseMove={handleMouseMove}
      id={id}
      className={cn("rounded-b-[4px] max-h-default-modal  text-emphasis font-medium overflow-y-auto no-scrollbar", className)}>
      {children}
    </ul>
  )
}

// ================ modal list element
export const ModalRowElementContainer: React.FC<IModalRowProps> = ({
  children,
  commandRef,
  handleMouseLeave,
  handleMouseEnter,
  isSelected,
  onClick,
  index,
  id,
  className,
  ...props
}) => {
  return (
    <li
      data-common-modal-row
      {...props}
      ref={commandRef}
      onMouseLeave={handleMouseLeave}
      // onMouseEnter={() => handleMouseEnter(index)}
      className={
        cn(`h-[36px] mx-1.5 rounded-sm px-3 text-dense cursor-pointer transition-all gap-3 duration-75 flex justify-between items-center ${isSelected ? "bg-active-modal-element" : ""}`
        , className)
      }
      id={id}
      // key={command.key}
      onClick={() => onClick(index)}
    >
      {children}
    </li>
  )
}

/** Keycap used in the ↑↓ / ↵ / esc hint bar at the bottom of the command-palette modals. */
export const HintKey = ({ children }: { children: React.ReactNode }) => (
  <kbd className="mr-1 rounded-sm bg-label-span px-[5px] py-[2px] font-sans text-micro font-medium leading-none text-white-black">
    {children}
  </kbd>
);

/** Shared footer for command-palette modals (Ctrl+K, links, remind-me). */
export const ModalHintBar = () => (
  <div className="flex items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
    <span><HintKey>↑↓</HintKey> navigate</span>
    <span><HintKey>↵</HintKey> select</span>
    <span><HintKey>esc</HintKey> close</span>
  </div>
);
