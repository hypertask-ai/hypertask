"use client";
import React, { ReactNode, useContext } from "react";
import { IUser } from "@/models/model";
import { TaskShareType } from "@prisma/client";
import { useRouter } from "next/navigation";
type Props = {
  children: ReactNode;
  shareId: string;
  shareType: TaskShareType;
  sharedUserEmail: string;
  checkBoardMember: 200 | 201 | 400 | undefined;
  user?: IUser;
};

const SharedTaskPageFooter = ({
  children,
  shareId,
}: Props) => {
  const router = useRouter();
  return (
    <>
      {children}
      {/* translate="no": same Chrome-Translate #418 guard as <main> (HTPR-4980). */}
      <div className="relative" translate="no">
        <div
          style={{
            zIndex: 5001,
          }}
          className="fixed bottom-0 border-t-[1px] border-t-black  bg-containerBackground w-full py-2.5 min-h-fit flex items-center justify-center"
        >
          <div className="flex items-center gap-2 text-content text-[#8E9093]">
            Part of the team? You&apos;re almost there to begin working in Hypertask
            <div
              className="flex items-center border-2 border-border-active-modal-element rounded cursor-pointer text-content bg-inherit hover:bg-active-modal-element px-2 py-1 font-medium text-[#8E9093] hover:text-white"
              onClick={() => {
                router.push(`/login?shareKey=${shareId}`);
              }}
            >
              Sign up or Login
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SharedTaskPageFooter;
