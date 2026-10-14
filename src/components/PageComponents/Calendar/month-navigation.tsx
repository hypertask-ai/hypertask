"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { addMonths, format, isSameMonth } from "date-fns";

export function MonthNavigation() {
  const { currentDate, currentView, setCurrentDate, handleDateSelect } = useCalendarContext();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const [startOffset, setStartOffset] = useState(-12);
  const [endOffset, setEndOffset] = useState(12);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousCurrentDateRef = useRef<Date>(currentDate);
  const isExtendingRef = useRef(false);

  const months: Date[] = [];
  for (let i = startOffset; i <= endOffset; i++) {
    months.push(addMonths(currentDate, i));
  }

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isScrolling || isExtendingRef.current) return;
    
    const container = scrollContainerRef.current;
    const scrollLeft = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;
    
    const threshold = 200;
    const nearStart = scrollLeft < threshold;
    const nearEnd = scrollLeft + clientWidth > scrollWidth - threshold;
    
    if (nearStart) {
      isExtendingRef.current = true;
      setIsScrolling(true);
      const previousScrollLeft = scrollLeft;
      const previousScrollWidth = scrollWidth;
      
      setStartOffset((prev) => prev - 12);
      
      setTimeout(() => {
        if (scrollContainerRef.current) {
          const newScrollWidth = scrollContainerRef.current.scrollWidth;
          const scrollDifference = newScrollWidth - previousScrollWidth;
          scrollContainerRef.current.scrollLeft = previousScrollLeft + scrollDifference;
          isExtendingRef.current = false;
          setIsScrolling(false);
        }
      }, 50);
    } else if (nearEnd) {
      isExtendingRef.current = true;
      setIsScrolling(true);
      const previousScrollLeft = scrollLeft;
      
      setEndOffset((prev) => prev + 12);
      
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = previousScrollLeft;
          isExtendingRef.current = false;
          setIsScrolling(false);
        }
      }, 50);
    }
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, [startOffset, endOffset, isScrolling]);

  const isClickingRef = useRef(false);
  
  useEffect(() => {
    const previousDate = previousCurrentDateRef.current;
    const monthsDifference = Math.abs(
      (currentDate.getFullYear() - previousDate.getFullYear()) * 12 +
      (currentDate.getMonth() - previousDate.getMonth())
    );
    
    if (monthsDifference > 0 && !isExtendingRef.current && isClickingRef.current) {
      setStartOffset(-12);
      setEndOffset(12);
      isClickingRef.current = false;
      
      setTimeout(() => {
        if (scrollContainerRef.current) {
          const currentMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
          const targetElement = scrollContainerRef.current.querySelector(
            `[data-month-key="${currentMonthKey}"]`
          ) as HTMLElement;
          
          if (targetElement) {
            const containerWidth = scrollContainerRef.current.offsetWidth;
            const elementLeft = targetElement.offsetLeft;
            const elementWidth = targetElement.offsetWidth;
            const targetScroll = elementLeft - (containerWidth / 2) + (elementWidth / 2);
            
            scrollContainerRef.current.scrollTo({
              left: Math.max(0, targetScroll),
              behavior: "auto",
            });
          }
        }
      }, 200);
    }
    
    previousCurrentDateRef.current = currentDate;
  }, [currentDate]);

  useEffect(() => {
    if (isExtendingRef.current) return;
    
    const scrollToCenter = () => {
      if (!scrollContainerRef.current) return;
      
      const container = scrollContainerRef.current;
      const currentMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
      
      const targetElement = container.querySelector(
        `[data-month-key="${currentMonthKey}"]`
      ) as HTMLElement;
      
      if (targetElement) {
        const containerWidth = container.offsetWidth;
        const elementLeft = targetElement.offsetLeft;
        const elementWidth = targetElement.offsetWidth;
        
        const targetScroll = elementLeft - (containerWidth / 2) + (elementWidth / 2);
        
        container.scrollTo({
          left: Math.max(0, targetScroll),
          behavior: "auto",
        });
      }
    };
    
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToCenter();
        });
      });
    }, 150);
    
    return () => clearTimeout(timeoutId);
  }, [currentDate, currentView, startOffset, endOffset]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  const handleMonthClick = (month: Date, event?: React.MouseEvent) => {
    event?.stopPropagation();
    
    const firstDayOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    
    isClickingRef.current = true;
    
    setCurrentDate(firstDayOfMonth);
    handleDateSelect(firstDayOfMonth);
  };

  if (currentView !== "month") {
    return null;
  }

  return (
    <div className="flex md:hidden inbox_footer no-scrollbar scrollbar-none w-full bg-hoverCardBackground h-20 inbox_title overflow-x-auto">
      <div
        ref={scrollContainerRef}
        className="flex gap-2 px-4 items-center h-full overflow-x-auto scrollbar-none no-scrollbar"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {months.map((month, index) => {
          const isCurrentMonth = isSameMonth(month, currentDate);
          const monthName = format(month, "MMM yyyy");
          const monthKey = `${month.getFullYear()}-${month.getMonth()}`;
          
          return (
            <div
              key={monthKey}
              data-month-key={monthKey}
              onClick={(e: React.MouseEvent) => handleMonthClick(month, e)}
            >
              <SplitTitle
                isSelected={isCurrentMonth}
                onClick={(e: any) => handleMonthClick(month, e)}
                tab={{
                  idx: index,
                  project: monthName,
                  length: 0,
                  hasUnseen: false,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
