"use client";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import React, { ReactNode } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { descriptionContainerClassname } from "@/utils/helperFunctions/TaskDetail/DescriptionContainerClsNameGen";

const SharedDescriptionContainer = ({ children }: { children: ReactNode }) => {
  const _mbl = useContext(MobileViewContext);
  const { currentId } = useTaskContext();

  const containerClassName = descriptionContainerClassname({
    isMobile: _mbl,
    containerId: descriptionContainerId,
    currentId: currentId,
    hasDraft: false,
    hasDraftInit: false,
  });
  

  return (
    <div
      tabIndex={0}
      id={descriptionContainerId}
      className={containerClassName}
      style={{ borderLeftWidth: !_mbl ? 4 : 0 }}
    >
      {children}
    </div>
  );
};

export default SharedDescriptionContainer;
