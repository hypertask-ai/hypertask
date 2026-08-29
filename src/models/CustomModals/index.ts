import { MutableRefObject, ReactNode, Ref, RefObject } from "react";
export interface IModalInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  autofocus?:boolean;
  ref?:Ref<HTMLInputElement>;
}
export interface ICustomModalContainerProps extends React.HTMLAttributes<HTMLElement> {
    children: ReactNode;
    isOpen: boolean;
    onOpened?: any;
    toggle?: any;
    className?: string;
    fade?: boolean;
    id: string;
    style?: any;
    autoFocus?: boolean;
    show?: boolean;
    backdrop?:boolean|"static"|undefined,
    animation?:boolean,
    shouldCloseOnClickOutside?:boolean,
    keyboard?:boolean,
    forceRenderOnlyChildren?:boolean;
    fullScreen?:boolean;
    trapFocus?: boolean;
    /**
     * Pin this modal to the pre-HTPR-4098 scale (60px rows, 24px header/input).
     * Opt-in: everything else inherits the compact palette scale the shared
     * primitives already default to.
     */
    legacySizing?: boolean;
    fullscreen?: boolean | 'sm' | 'md' | 'lg' | 'xl';
    contentClassName?:string;
    /**
     * Class for reactstrap's outer `.modal` element (the viewport-wide fixed box), as
     * opposed to `className`, which lands on `.modal-dialog`. Reactstrap hardcodes an
     * inline style on that outer element, so a class is the only way to influence it.
     */
    modalClassName?: string;
    scrollable?: boolean;
  }

export interface IModalRowProps extends React.HTMLAttributes<HTMLLIElement> {
    children:ReactNode;
    commandRef?:any;
    handleMouseLeave?: () => void;
    handleMouseEnter?: (index: number) => void;
    isSelected:boolean;
    onClick?:any;
    index?:number,
    id?:string,
    ref?:RefObject<HTMLDivElement | null>
  
  
}


export interface IModalHeaderProps extends React.HTMLAttributes<HTMLElement>{
    children?: ReactNode,
    header: string,
    className?: string,
    fullscreen?: boolean,
    headerClassName?:string,
    subHeadline?:string,
    subHeadlineClassName?: string,
    shouldShowSeparator?:boolean
    toggle?: any;
}

export interface IModalListContainerProps extends React.HTMLAttributes<HTMLUListElement> { 
    children: 
    ReactNode, 
    id: string, 
    className?: string, 
    handleMouseMove?: any,
    ref?:MutableRefObject<HTMLUListElement | null>
  }
