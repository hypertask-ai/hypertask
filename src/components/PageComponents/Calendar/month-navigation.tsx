"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { addMonths, format, isSameMonth } from "date-fns";

export function MonthNavigation() {
  const { currentDate, currentView, setCurrentDate, handleDateSelect } = useCalendarContext();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Track the range of months to display (offsets from currentDate)
  const [startOffset, setStartOffset] = useState(-12);
  const [endOffset, setEndOffset] = useState(12);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousCurrentDateRef = useRef<Date>(currentDate);
  const isExtendingRef = useRef(false);

  // Generate months based on current range
  const months: Date[] = [];
  for (let i = startOffset; i <= endOffset; i++) {
    months.push(addMonths(currentDate, i));
  }

  // Handle scroll to detect when reaching boundaries
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isScrolling || isExtendingRef.current) return;
    
    const container = scrollContainerRef.current;
    const scrollLeft = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;
    
    // Threshold: extend when within 200px of the edge
    const threshold = 200;
    const nearStart = scrollLeft < threshold;
    const nearEnd = scrollLeft + clientWidth > scrollWidth - threshold;
    
    if (nearStart) {
      // Extend backward by 12 months (unlimited)
      isExtendingRef.current = true;
      setIsScrolling(true);
      const previousScrollLeft = scrollLeft;
      const previousScrollWidth = scrollWidth;
      
      setStartOffset((prev) => prev - 12);
      
      // Maintain scroll position after DOM update
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
      // Extend forward by 12 months
      isExtendingRef.current = true;
      setIsScrolling(true);
      const previousScrollLeft = scrollLeft;
      
      setEndOffset((prev) => prev + 12);
      
      // Maintain scroll position after DOM update
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = previousScrollLeft;
          isExtendingRef.current = false;
          setIsScrolling(false);
        }
      }, 50);
    }
    
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Set a timeout to reset isScrolling flag
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, [startOffset, endOffset, isScrolling]);

  // Track if we're clicking (not just scrolling)
  const isClickingRef = useRef(false);
  
  // Reset offsets when currentDate changes (from month click)
  useEffect(() => {
    const previousDate = previousCurrentDateRef.current;
    const monthsDifference = Math.abs(
      (currentDate.getFullYear() - previousDate.getFullYear()) * 12 +
      (currentDate.getMonth() - previousDate.getMonth())
    );
    
    // If the date changed and we're not extending, reset to default range
    // This ensures the clicked month is always centered
    if (monthsDifference > 0 && !isExtendingRef.current && isClickingRef.current) {
      setStartOffset(-12);
      setEndOffset(12);
      isClickingRef.current = false;
      
      // Trigger centering after a short delay to ensure DOM is updated
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

  // Scroll to center on mount and when currentDate changes
  useEffect(() => {
    // Skip if we're currently extending
    if (isExtendingRef.current) return;
    
    // Function to scroll to center
    const scrollToCenter = () => {
      if (!scrollContainerRef.current) return;
      
      const container = scrollContainerRef.current;
      const currentMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
      
      // Find the element by data attribute
      const targetElement = container.querySelector(
        `[data-month-key="${currentMonthKey}"]`
      ) as HTMLElement;
      
      if (targetElement) {
        // Calculate scroll position to center the element
        const containerWidth = container.offsetWidth;
        const elementLeft = targetElement.offsetLeft;
        const elementWidth = targetElement.offsetWidth;
        
        // Center the element: element's left position - half container width + half element width
        const targetScroll = elementLeft - (containerWidth / 2) + (elementWidth / 2);
        
        container.scrollTo({
          left: Math.max(0, targetScroll), // Ensure non-negative
          behavior: "auto",
        });
      }
    };
    
    // Use timeout and requestAnimationFrame to ensure DOM is updated
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToCenter();
        });
      });
    }, 150);
    
    return () => clearTimeout(timeoutId);
  }, [currentDate, currentView, startOffset, endOffset]);

  // Add scroll event listener
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
    // Prevent event propagation
    event?.stopPropagation();
    
    // Set the first day of the selected month
    const firstDayOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    
    // Mark that we're clicking (not scrolling)
    isClickingRef.current = true;
    
    // Update currentDate - this will trigger re-render, offset reset, and centering
    setCurrentDate(firstDayOfMonth);
    // Also call handleDateSelect to update focus and currentDay
    handleDateSelect(firstDayOfMonth);
  };

  // Only show in month view
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
          // Use month date as key for stability when extending
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
                  length: 0, // We don't need task count for months
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
