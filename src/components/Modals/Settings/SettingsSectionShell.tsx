"use client";

import { ReactNode, useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

interface SettingsSectionShellProps {
  children: ReactNode;
  description?: string;
  fullHeight?: boolean;
  headerAction?: ReactNode;
  title: string;
}

const SettingsSectionShell: React.FC<SettingsSectionShellProps> = ({
  children,
  description,
  fullHeight = false,
  headerAction,
  title,
}) => {
  const mbl = useContext(MobileViewContext);

  return (
    <section
      className={`flex w-full flex-col gap-8 ${
        fullHeight ? "min-h-0 flex-1" : "pb-10"
      }`}
    >
      {(!mbl || description) && (
        <div className="flex flex-col gap-1">
          {!mbl && (headerAction ? (
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-heading font-semibold text-white-black">
                {title}
              </h2>
              {headerAction}
            </div>
          ) : (
            <h2 className="text-heading font-semibold text-white-black">
              {title}
            </h2>
          ))}
          {description && (
            <p className="text-dense font-medium text-text-light-gray">
              {description}
            </p>
          )}
        </div>
      )}
      <div
        className={`flex w-full flex-col gap-8 ${
          fullHeight ? "min-h-0 flex-1" : ""
        }`}
      >
        {mbl && headerAction && (
          <div className="flex justify-end">{headerAction}</div>
        )}
        {children}
      </div>
    </section>
  );
};

export default SettingsSectionShell;
