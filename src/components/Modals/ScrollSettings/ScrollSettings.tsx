import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { useGetScrollSetting } from "@/hooks/General/useGetScrollSetting";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import globalConstants from "@/lib/constants";
import { ScrollSetting } from "@prisma/client";
import axios from "axios";
import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
interface IScrollSettings {
  toggle: (val?: boolean) => void;
}

interface IScrollOption {
  text: string;
  type: ScrollSetting;
}

const scrollOptions: IScrollOption[] = [
  {
    text: "No Scroll",
    type: "None",
  },
  {
    text: "Scroll to bottom",
    type: "Bottom",
  },
  {
    text: "Scroll to bottom when coming from inbox",
    type: "Inbox",
  },
];

const ScrollSettings: React.FC<IScrollSettings> = ({ toggle }) => {
  const {
    data,
    refetch: refetchSetting,
    isRefetching: settingTQFromRefetching,
  } = useGetScrollSetting([globalConstants.ScrollSettingKey]);

  const [currentSetting, setSetting] = useState<ScrollSetting | undefined>(
    data.setting
  );

  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  async function enterHandler(index: number) {
    setSetting(scrollOptions[index].type);
    changeScrollSetting(scrollOptions[index].type);
    toggle();
  }

  const changeScrollSetting = async (newSetting: ScrollSetting) => {
    try {
      const response = await axios.post(
        "/api/users/scrollSettings/changeScrollSetting",
        {
          setting: newSetting,
        }
      );
      if (response.status == 200) {
        console.log("success");
        refetchSetting();
      } else {
        console.log("error occured");
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    const keydown = (e: KeyboardEvent) =>
      handleKeydown(e, scrollOptions.length, "label-htc-option-", toggle);
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [handleKeydown]);

  useEffect(() => {
    if (data.setting) {
      setSetting(data.setting);
    }
  }, [data]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="scrollSettingModal"
      toggle={() => toggle()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp header={`Scroll Settings`} className="px-[20px]" />
      <ModalBody className="p-0">
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="scroll-setting-modal-container"
        >
          {scrollOptions?.map((option, index) => (
            <ModalRowElementContainer
              key={`el-${index}`}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={() => enterHandler(index)}
              id={`label-htc-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <ScrollOptionTitle option={option} />
              {/* {must check here if the current value of the scroll is you know, marked} */}
              {currentSetting === option.type && <Check strokeWidth={1.75} size={14} />}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default ScrollSettings;

const ScrollOptionTitle = ({ option }: { option: any }) => {
  return (
    <div className="flex items-center gap-2">
      <span>{option.text}</span>
    </div>
  );
};
