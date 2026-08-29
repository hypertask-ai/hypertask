import { showScrollSettingModalAtom, showSidebarAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { SingleSectionContentTitle } from "./Single section items";
import { useGetScrollSetting } from "@/hooks/General/useGetScrollSetting";
import globalConstants from "@/lib/constants";

const ScrollButton = () => {
  const [_, setShowSidebar] = useRecoilState(showSidebarAtom);
  const [__, setShowScrollSettings] = useRecoilState(
    showScrollSettingModalAtom
  );
  const { data } = useGetScrollSetting([globalConstants.ScrollSettingKey]);

  return (
    <SingleSectionContentTitle
      id="task-scroll-settings"
      title="Task Scroll Settings"
      onClick={() => {
        setShowSidebar(false);
        setShowScrollSettings(true);
      }}
    />
  );
};

export default ScrollButton;
