import { format, subBusinessDays } from "date-fns";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { inputChange } from "@/utils/helperFunctions/dateParse";
import { IValuePropUpdatedAt, TFilter } from "@/models/Filters/model";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import toast from "react-hot-toast";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

export const useDateFilter = (
  closebackHandler: (payload: any) => void,
  mode: TFilter
) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const activeFilters =
    getActiveFiltersFromProject(currentProject).addedFilters;
  const currentlyActive = activeFilters.find((filter) => filter.type === mode);

  const [date, setDate] = useState<DateRange | undefined>({
    from: currentlyActive?.searchPayload[0].fromDate
      ? new Date(currentlyActive.searchPayload[0].fromDate)
      : subBusinessDays(new Date(), 3),
    to: currentlyActive?.searchPayload[0].toDate
      ? new Date(currentlyActive.searchPayload[0].toDate)
      : new Date(),
  });

  const onClickHandler = () => {
    if (!date) toast("Please select a date first!");
    else {
      closebackHandler(date);
    }
  };

  const defaultOptions: any[] = useMemo(() => {
    const options = [
      currentlyActive
        ? {
            display: "Reset",
            date: undefined,
            dateRangeDisplay: "",
            isDynamic: false,
          }
        : null,

      mode === "DueDate"
        ? {
            display: "Any",
            date: undefined,
            dateRangeDisplay: "",
            dynamicRange: "ANY",
            isDynamic: true,
          }
        : null,

      {
        display: "Today",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "TODAY",
        isDynamic: true,
      },
      {
        display: "Yesterday",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "YESTERDAY",
        isDynamic: true,
      },
      {
        display: "Last 7 days",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "LAST_7_DAYS",
        isDynamic: true,
      },
      {
        display: "Last 30 days",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "LAST_30_DAYS",
        isDynamic: true,
      },
      {
        display: "This week",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "THIS_WEEK",
        isDynamic: true,
      },
      {
        display: "This month",
        date: undefined,
        dateRangeDisplay: "",
        dynamicRange: "THIS_MONTH",
        isDynamic: true,
      },
      {
        display: "Pick a custom date range",
        date: undefined,
        dateRangeDisplay: "",
        isDynamic: false,
      },
    ];

    return options.filter(Boolean);
  }, [currentlyActive]);

  const [keyword, setKeyword] = useState("");
  const [filteredOptions, setFilteredOptions] = useState<any[]>(defaultOptions);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const filterCommandsLen = useMemo(
    () => filteredOptions.length,
    [filteredOptions]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target.value;
      setKeyword(input);
      setSelectedIndex(0);

      if (input.length === 0) {
        setFilteredOptions(defaultOptions);
        return;
      }

      // Get Sugar date suggestions
      const sugarSuggestions: any = inputChange(input, {
        past: true,
        future: mode === "DueDate",
      });

      // Add date display to Sugar suggestions (these are static)
      const enhancedSugarSuggestions = sugarSuggestions.map(
        (suggestion: any) => {
          if (suggestion.date) {
            return {
              ...suggestion,
              dateRangeDisplay: format(
                new Date(suggestion.date),
                "do MMM, yyyy"
              ),
              isDynamic: false, // Sugar suggestions are static dates
            };
          }
          return suggestion;
        }
      );

      // Filter default options based on input
      const filteredDefaults = defaultOptions.filter((option) => {
        if (!option.display) return false;
        return option.display.toLowerCase().includes(input.toLowerCase());
      });

      // Combine filtered defaults with Sugar suggestions, avoiding duplicates
      const combinedOptions = [...filteredDefaults];

      // Add Sugar suggestions that aren't already in defaults
      enhancedSugarSuggestions.forEach((suggestion: any) => {
        const isDuplicate = combinedOptions.some(
          (opt) =>
            opt.display?.toLowerCase() === suggestion.display?.toLowerCase()
        );
        if (!isDuplicate) {
          combinedOptions.push(suggestion);
        }
      });

      setFilteredOptions(combinedOptions);
    },
    [defaultOptions, mode]
  );

  const handleCommandSelect = useCallback((commandIndex: number) => {
    setSelectedIndex(commandIndex);
    document
      .getElementById(`label-htc-option-${commandIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const enterHandler = useCallback(
    async (index: number) => {
      const selectedLabel = filteredOptions[index];
      closebackHandler(selectedLabel);
    },
    [filteredOptions, closebackHandler]
  );

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.keyCode === KeyCodes.ARROW_UP) {
      if (selectedIndex === 0) return;
      const selectedIdx =
        (selectedIndex + filterCommandsLen - 1) % filterCommandsLen;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ARROW_DOWN) {
      if (selectedIndex === filterCommandsLen - 1) return;
      const selectedIdx = (selectedIndex + 1) % filterCommandsLen;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ENTER && !(event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      enterHandler(selectedIndex);
    }
    if ((event.ctrlKey || event.metaKey) && event.keyCode === KeyCodes.ENTER) {
      setTimeout(() => {
        closebackHandler(date);
      }, 1);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filterCommandsLen]);

  return {
    handleInputChange,
    keyword,
    filteredOptions,
    selectedIndex,
    setSelectedIndex,
    enterHandler,
    date,
    setDate,
    onClickHandler,
  };
};
