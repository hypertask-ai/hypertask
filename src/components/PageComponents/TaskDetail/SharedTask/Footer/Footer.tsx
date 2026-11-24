"use client";
import React, { ReactNode, useContext } from "react";
import { IUser } from "@/models/model";
import { TaskShareType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

export const GUEST_INVITE_MESSAGE =
  "Part of the team? You're almost there to begin working in Hypertask";
export const GUEST_INVITE_ACTION = "Sign up or Login";

type Props = {
  children: ReactNode;
  shareId: string;
  shareType: TaskShareType;
  sharedUserEmail: string;
  checkBoardMember: 200 | 201 | 400 | undefined;
  user?: IUser;
  stackedOnPhone?: boolean;
};

export const GuestInviteBar = ({
  onAction,
  stackedOnPhone = false,
}: {
  onAction: () => void;
  stackedOnPhone?: boolean;
}) => {
  const isMobile = useContext(MobileViewContext);
  const stacked = stackedOnPhone && isMobile;
  return (
    <div
      className={
        stacked
          ? "flex w-full max-w-md flex-col items-stretch gap-2 px-4 text-center"
          : "flex items-center gap-2"
      }
    >
      <p className="text-content text-text-light-gray">{GUEST_INVITE_MESSAGE}</p>
      <div
        className="flex shrink-0 items-center justify-center whitespace-nowrap border-2 border-border-active-modal-element rounded cursor-pointer text-content bg-inherit hover:bg-active-modal-element px-2 py-1 font-medium text-text-light-gray hover:text-white"
        onClick={onAction}
      >
        {GUEST_INVITE_ACTION}
      </div>
    </div>
  );
};

const SharedTaskPageFooter = ({
  children,
  shareId,
  stackedOnPhone = false,
}: Props) => {
  const router = useRouter();
  const isMobile = useContext(MobileViewContext);
  const stacked = stackedOnPhone && isMobile;
  return (
    <>
      {children}
      {stacked && <div aria-hidden className="h-32 shrink-0" />}
      <div className="relative" translate="no">
        <div
          style={{
            zIndex: 5001,
          }}
          className={
            stacked
              ? "fixed inset-x-0 bottom-0 flex items-center justify-center border-t-[1px] border-t-black bg-containerBackground py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
              : "fixed bottom-0 border-t-[1px] border-t-black bg-containerBackground w-full py-2.5 min-h-fit flex items-center justify-center"
          }
        >
          <GuestInviteBar
            onAction={() => {
              router.push(`/login?shareKey=${shareId}`);
            }}
            stackedOnPhone={stackedOnPhone}
          />
        </div>
      </div>
    </>
  );
};

export default SharedTaskPageFooter;
