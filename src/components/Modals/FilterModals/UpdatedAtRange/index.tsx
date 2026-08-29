/* eslint-disable react-hooks/exhaustive-deps */
import { Calendar } from "@/components/Common/Calendar";
import {
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { format } from "date-fns";
import { useCallback, useState } from "react";
import { ModalBody } from "reactstrap";
import formatDateDifference from "@/utils/generateTime";
import { IValuePropUpdatedAt, TFilter } from "@/models/Filters/model";
import Tooltip from "@/components/Common/Tooltip";
import {
  calculateDynamicDateRange,
  formatDateRange,
} from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { useDateFilter } from "@/hooks/MultiPages/Filters/useDateFilter";

type TScreens = "Custom" | "Sugar";
interface Props {
  mode: "createdAt" | "updatedAt" | "dueDate";
  closeHandler: (callback: IValuePropUpdatedAt | null, reset?: boolean) => void;
}

interface IScreenProps {
  closebackHandler: (payload: any, back?: boolean) => void;
  mode: TFilter;
}
interface IClosePayload {
  fromDate?: string | null;
  toDate?: string | null;
  selectedDate?: string | null;
  condition?: "ANY" | "AFTER" | "BEFORE" | null;
  dynamicRange?:
    | "TODAY"
    | "YESTERDAY"
    | "LAST_7_DAYS"
    | "LAST_30_DAYS"
    | "THIS_WEEK"
    | "THIS_MONTH"
    | null;
}

const UpdatedAtRangeFilterModal: React.FC<Props> = ({ closeHandler, mode }) => {
  const [selectedScreen, setSelectedScreen] = useState<TScreens>("Sugar");

  const callbackToSwitchScreen = (screen: TScreens) =>
    setSelectedScreen(screen);

  const handleClose = useCallback(
    (payload: IClosePayload | null, reset?: boolean) => {
      if (reset) {
        closeHandler(null, true);
        return;
      }

      if (payload) {
        closeHandler({
          fromDate: payload.fromDate ?? null,
          toDate: payload.toDate ?? null,
          selectedDate: payload.selectedDate ?? null,
          condition: payload.condition ?? null,
          dynamicRange: payload.dynamicRange ?? null,
        });
      }
    },
    [closeHandler]
  );

  const closebackHandler = useCallback(
    (payload: any, back?: boolean) => {
      if (selectedScreen === "Custom") {
        if (back) {
          callbackToSwitchScreen("Sugar");
          return;
        }

        // Custom calendar selections are always static
        handleClose({
          fromDate: payload.from?.toISOString() ?? null,
          toDate: payload.to?.toISOString() ?? null,
          condition: null,
          selectedDate: payload.from?.toISOString() ?? null,
          dynamicRange: null, // Static selection
        });
      } else if (selectedScreen === "Sugar") {
        if (!payload.data && payload.display === "Reset") {
          handleClose(null, true);
          return;
        }

        // Handle dynamic ranges
        if (payload.isDynamic && payload.dynamicRange) {
          handleClose({
            fromDate: null,
            toDate: null,
            selectedDate: null,
            condition: payload.dynamicRange === "ANY" ? "ANY" : null,
            dynamicRange: payload.dynamicRange,
          });
          return;
        }

        // Handle static predefined date ranges (for backward compatibility)
        const dateRangeHandlers: Record<string, () => IClosePayload> = {
          Any: () => ({
            fromDate: null,
            toDate: null,
            selectedDate: null,
            condition: "ANY",
            dynamicRange: null,
          }),
        };

        if (!payload.date) {
          const handler = dateRangeHandlers[payload.display];
          if (handler) {
            handleClose(handler());
          } else {
            callbackToSwitchScreen("Custom");
          }
        } else {
          // Static date selection from Sugar
          handleClose({
            fromDate: payload.date,
            toDate: null,
            selectedDate: payload.date,
            condition: "AFTER",
            dynamicRange: null,
          });
        }
      }
    },
    [selectedScreen, handleClose]
  );

  const getModeForScreens = useCallback(() => {
    const modeMap: Record<string, TFilter> = {
      createdAt: "CreatedAt",
      dueDate: "DueDate",
      updatedAt: "UpdatedRange",
    };
    return modeMap[mode] || "UpdatedRange";
  }, [mode]);

  return (
    <>
      <ModalHeaderComp
        header={`Filter by ${
          mode === "updatedAt"
            ? "last updated"
            : mode === "dueDate"
            ? "due"
            : "created"
        } date`}
      >
        <span className="text-content text-text-light-gray whitespace-nowrap">
          SHIFT+ESC to go back
        </span>
      </ModalHeaderComp>

      <ModalBody className="p-0 rounded-b-[4px]">
        {selectedScreen === "Custom" ? (
          <CustomCalendarScreen
            mode={getModeForScreens()}
            closebackHandler={closebackHandler}
          />
        ) : (
          <SugarDateScreen
            mode={getModeForScreens()}
            closebackHandler={closebackHandler}
          />
        )}
      </ModalBody>
    </>
  );
};

const CustomCalendarScreen: React.FC<IScreenProps> = ({
  closebackHandler,
  mode,
}) => {
  const { date, setDate, onClickHandler } = useDateFilter(
    closebackHandler,
    mode
  );
  return (
    <div>
      <span className="px-4">
        {date?.from ? (
          date.to ? (
            <>
              {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
            </>
          ) : (
            format(date.from, "LLL dd, y")
          )
        ) : (
          <span>Pick a date</span>
        )}
      </span>
      <Calendar
        className=""
        initialFocus
        mode="range"
        defaultMonth={date?.from}
        selected={date}
        onSelect={setDate}
        numberOfMonths={2}
      />
      <div className="flex px-4 gap-1 py-1 justify-end">
        <div
          className="inline-flex cursor-pointer items-center text-dense text-text-light-gray hover:text-white-black"
          onClick={() => closebackHandler(date, true)}
        >
          Back
        </div>
        <div
          className="relative group inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm px-3 text-dense font-medium bg-label-span text-white-black hover:bg-hover-active border-0"
          onClick={onClickHandler}
        >
          Confirm
          <Tooltip
            left={-44}
            bottom={-40}
            text="Confirm Selection"
            keyCombination={["CTRL", "E"]}
          />
        </div>
      </div>
    </div>
  );
};

const SugarDateScreen: React.FC<IScreenProps> = ({
  closebackHandler,
  mode,
}) => {
  const {
    keyword,
    handleInputChange,
    selectedIndex,
    setSelectedIndex,
    filteredOptions,
    enterHandler,
  } = useDateFilter(closebackHandler, mode);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  return (
    <>
      <ModalInput
        id="filter-input"
        value={keyword}
        placeholder="e.g. four days ago, last week tuesday ..."
        onChange={handleInputChange}
      />
      <ModalListContainer
        handleMouseMove={handleMouseMove}
        id="filteredCommandsList"
      >
        {filteredOptions?.map((option, index) => {
          // Calculate display for dynamic options
          let displayDateRange = option.dateRangeDisplay;

          if (
            option.isDynamic &&
            option.dynamicRange &&
            option.dynamicRange !== "ANY"
          ) {
            const range = calculateDynamicDateRange(option.dynamicRange);
            if (range) {
              displayDateRange = formatDateRange(range.from, range.to);
            }
          }

          return (
            <ModalRowElementContainer
              key={index}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={enterHandler}
              id={`label-htc-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <span className="flex-1 flex justify-between items-center gap-2">
                {option?.display}
                {option?.isDynamic &&
                  option?.dynamicRange &&
                  option.dynamicRange !== "ANY" &&
                  (() => {
                    const range = calculateDynamicDateRange(
                      option.dynamicRange
                    );
                    if (range) {
                      const fromStr = format(range.from, "d MMM, yyyy");
                      const toStr = format(range.to, "d MMM, yyyy");
                      return (
                        <span className="text-text-light-gray text-meta">
                          {fromStr}
                          {fromStr !== toStr ? ` - ${toStr}` : ""}
                        </span>
                      );
                    }
                    return null;
                  })()}
              </span>
              {displayDateRange && (
                <span className="text-text-light-gray text-content">
                  {displayDateRange}
                </span>
              )}
              {option?.date && !displayDateRange && (
                <span className="text-text-light-gray text-content">
                  {formatDateDifference(option?.date, !option.default && true)}
                </span>
              )}
            </ModalRowElementContainer>
          );
        })}
      </ModalListContainer>
    </>
  );
};

export default UpdatedAtRangeFilterModal;
