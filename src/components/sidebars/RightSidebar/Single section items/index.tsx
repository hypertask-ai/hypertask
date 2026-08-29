import Tooltip from "@/components/Common/Tooltip"
import { useSidebarContext } from "@/lib/contexts/Sidebars/SidebarProvider";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import {
  ComponentType,
  ReactNode,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { useRecoilState } from "@/lib/state";
import { showShortcutsAtom, showQuickTipsAtom } from "@/store";
import Link from "next/link";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";

interface IProps{
  children?:ReactNode;
  title:string;
  id:string;
  onClick?:any
}

interface ILinkedSectionTitle {
  id:string;
  href:string;
  title:string
}
export const SingleSectionContentTitle:React.FC<IProps> = ({title, id, children,onClick})=>{
  return (
    <div
    id={id}
    className="text-start w-full cursor-pointer font-normal relative group text-white-black"
    onClick={onClick}
    >
      <h3 className="text-content">
        {title}
      </h3>
      {children}
    </div>
  )
}

export const LinkedSingleSectionContentTitle:React.FC<ILinkedSectionTitle> = ({href, id, title})=>{
  return (
    <Link target="_blank" href={href} rel="noopener noreferrer">
     <SingleSectionContentTitle 
            id={id} 
            title={title}/>
    </Link>
  )
}

export interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  inputId: string;
  label: string;
  description?: string;
  onChange: (
    event: ChangeEvent<HTMLInputElement> | MouseEvent<HTMLButtonElement>
  ) => void;
  showLabel?: boolean;
  value?: unknown;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, description, inputId, value, checked, onChange, disabled }) => {

  return (
    <div className={`d-flex items-center text-content ${description ? "" : "h-[17.39px]"}`}>
      <div className="mr-3">
        <h3 className="text-content font-normal text-white-black">
          {label}
        </h3>
        {description ? (
          <p className="text-content text-text-light-gray">{description}</p>
        ) : null}
      </div>
      <div className="form-check form-switch m-0">
        <input
          className="form-check-input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          id={inputId}
          value={value == null ? undefined : String(value)}
          onChange={onChange}
        />
      </div>
    </div>
  );
};

const ToggleQuickTips = ({ ToggleComponent = ToggleSwitch }: { ToggleComponent?: ComponentType<ToggleSwitchProps> } = {})=>{
  const [showQuickTips, setShowQuickTips] = useRecoilState(showQuickTipsAtom)
  return (
    <ToggleComponent
      label="Quick Tips" 
      inputId="quick-tips-toggle"
      value={showQuickTips?"true":"false"}
      checked={showQuickTips}
      onChange={(()=>setShowQuickTips(prev=>!prev))}
    />

  )
}

const ToggleDarkAndLightMode = ({ ToggleComponent = ToggleSwitch }: { ToggleComponent?: ComponentType<ToggleSwitchProps> } = {})=>{
  const { toggleDarkModeHandler, effectiveTheme } = useDarkMode()
  return (
    <>
    <ToggleComponent
      label="Dark Mode" 
      inputId="dark-mode-toggle"
      value={effectiveTheme === "dark" ? "true" : "false"}
      checked={effectiveTheme === "dark"}
      onChange={toggleDarkModeHandler}
      />
      
    </>
  );
}


const KeyboardShortcutsInSidebar = ()=>{
  const [_showShortcuts, setShowShortcuts] = useRecoilState(showShortcutsAtom);
  const {_appHandler} = useSidebarContext()
    return (
        <SingleSectionContentTitle 
          id="keyboard-sidebar-settings" 
          title="Keyboard Shortcuts" 
          onClick={() => {setShowShortcuts(true)}}
        >

            <Tooltip 
              left={0}
              bottom={-40}
              text='Keyboard shortcuts'
              keyCombination={[`SHIFT` ,"?"]}
              />
          </SingleSectionContentTitle>
    )
}


const TutorialVideos = ()=>{
  return (
    <LinkedSingleSectionContentTitle
      href="https://www.youtube.com/playlist?list=PLb7ZrOwcC7l2Du0sq2-fj4uJG7N0vjxmQ"
      id="sidebar-tutorial-videos" 
      title="Tutorial Videos"
     />
  )
}

const MCPTutorial = ()=>{
  return (
    <LinkedSingleSectionContentTitle
      href="https://help.hypertask.ai/help/how-to-connect-ai-agents-to-hypertask-with-mcp"
      id="sidebar-mcp-tutorial" 
      title="API/MCP Guide"
     />
  )
}

const BookCoaching = ()=>{
  // Book 1:1 Coaching (https://book.vimcal.com/p/valentinyeo/30-minute-meeting-fbcb1)
  return(
    <LinkedSingleSectionContentTitle
      id="BookCoaching" 
      title="Book 1:1 Coaching"
      href="https://calendar.superhuman.com/book/11SzDGi12vkuEu8gf0/icPzJ"
     />
   
  )
}

// https://hypertask.ai/help
const HelpCenter = ()=>{
  return(
    <LinkedSingleSectionContentTitle
      id="help-center"
      title="Help Center"
      href="https://help.hypertask.ai/"
    />

  )
}
const Docs = ()=>{
  return(
    <LinkedSingleSectionContentTitle
      id="sidebar-docs"
      title="Docs"
      href="https://docs.hypertask.ai/"
    />
  )
}
const Contact = () => {
  return (
    <LinkedSingleSectionContentTitle
      id="sidebar-contact"
      title="Contact"
      href="mailto:help@hypertask.ai" />

  )
}

const SendFeedback = () => {
  const { setSettingsSection } = useSettingsNavigation();
  return (
    <SingleSectionContentTitle
      id="sidebar-send-feedback"
      title="Send Feedback"
      onClick={() => setSettingsSection("feedback")}
    />
  )
}

const McpTokenLink = ({ onClick }: { onClick: () => void }) => {
  return (
    <SingleSectionContentTitle
      id="sidebar-mcp-token"
      title="Hypertask MCP"
      onClick={onClick}
    />
  )
}

export { 
  KeyboardShortcutsInSidebar,TutorialVideos,ToggleQuickTips, BookCoaching,
  ToggleDarkAndLightMode,
  Contact,SendFeedback,HelpCenter, Docs, McpTokenLink, MCPTutorial


} 
