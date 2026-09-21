    const formatDateDifference = (createdAt: string|Date | null, reminder?: boolean) => {
        // console.log("🚀 ~ formatDateDifference ~ reminder:", reminder)
        if (!createdAt) return
        // const dummy = "2023-08-10T14:47:05.282Z"; // Adjust the date and time as needed
        const currentTime = new Date();
        const notificationTime = new Date(createdAt);
        
        var timeDifference:number;
        if (reminder){
            timeDifference = (notificationTime.getTime() - currentTime.getTime()) / 1000; // Convert to seconds
        }
        else {
            timeDifference = (currentTime.getTime() - notificationTime.getTime()) / 1000; // Convert to seconds

        }
        // console.log("🚀 ~ formatDateDifference ~ timeDifference:", timeDifference)
      
        if (timeDifference < 60&& !reminder ) {
          return `Just now`;
        } else if (timeDifference < 3600 && !reminder) {
          const minutes = Math.floor(timeDifference / 60);
          return `${minutes}min`;
        } else if (timeDifference < 43200) {
          return notificationTime.toLocaleString('en-US', { hour: "numeric", minute: "numeric", hour12: true });
        } else {
          if (reminder) {
            // For future dates and reminders, return a formatted date/time
            return notificationTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
          } else {
            // Past dates: day + month ("11 Dec"), plus the year whenever the date
            // falls outside the CURRENT CALENDAR YEAR.
            //
            // This used to trigger on 365 days elapsed (HTPR-3202), which left a
            // gap of up to a year: on 7 Aug 2026 a comment from Sep 2025 was only
            // ~11 months old, so it rendered "12 Sep" and read as five weeks ago
            // rather than eleven months (HTPR-5124). A calendar-year check has no
            // such gap, and it matches the rule the due chip and the table's
            // Created column already use.
            const day = notificationTime.getDate();
            const month = notificationTime.toLocaleString('default', { month: 'short' });
            const year = notificationTime.getFullYear();
            if (year !== currentTime.getFullYear()) return `${day} ${month} ${year}`;
            return `${day} ${month}`;
          }
        }
      };
      

    const formatDueDateDifference = (dueDate: string | Date | null): string | undefined => {
        if (!dueDate) return undefined;
        
        const currentTime = new Date();
        const dueDateTime = new Date(dueDate);

        // Extract and format the time in hour:minute am/pm (e.g. "7:30 am")
        const formatTime = (date: Date) => {
            return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
        };
        
        // Calculate difference in milliseconds
        const timeDifference = dueDateTime.getTime() - currentTime.getTime();

        // Check if overdue (negative difference means past)
        if (timeDifference < 0) {
            const daysOverdue = Math.floor(Math.abs(timeDifference) / (1000 * 60 * 60 * 24));
            const hoursOverdue = Math.floor(Math.abs(timeDifference) / (1000 * 60 * 60));
            const timeLabel = `, ${formatTime(dueDateTime)}`;
            
            if (daysOverdue === 0) {
                // Less than a day overdue
                if (hoursOverdue === 0) {
                    const minutesOverdue = Math.floor(Math.abs(timeDifference) / (1000 * 60));
                    if (minutesOverdue === 0) {
                        return "Just now";
                    }
                    return `${minutesOverdue} ${minutesOverdue === 1 ? 'min' : 'mins'} ago${timeLabel}`;
                }
                return `${hoursOverdue} ${hoursOverdue === 1 ? 'hr' : 'hrs'} ago${timeLabel}`;
            } else if (daysOverdue === 1) {
                return `1 day ago${timeLabel}`;
            } else {
                return `${daysOverdue} days ago${timeLabel}`;
            }
        }

        // Future dates
        const daysUntil = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
        const hoursUntil = Math.floor(timeDifference / (1000 * 60 * 60));
        const timeLabel = `, ${formatTime(dueDateTime)}`;

        // Check if it's today
        const today = new Date(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate());
        const dueDateOnly = new Date(dueDateTime.getFullYear(), dueDateTime.getMonth(), dueDateTime.getDate());

        if (dueDateOnly.getTime() === today.getTime()) {
            return `Today${timeLabel}`;
        }

        // Check if it's tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (dueDateOnly.getTime() === tomorrow.getTime()) {
            return `Tomorrow${timeLabel}`;
        }

        // For dates within a week, show days
        if (daysUntil > 0 && daysUntil <= 7) {
            return `In ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}${timeLabel}`;
        }

        // For dates further in the future, show formatted date with time
        if (daysUntil > 7) {
            return dueDateTime.toLocaleString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                year: daysUntil > 365 ? 'numeric' : undefined
            }).replace(',', '') // Remove the comma after the weekday if present
            .replace(/(\d{1,2}:\d{2})/, match => match.toLowerCase());
        }

        // For very near future (less than a day but not today)
        if (hoursUntil > 0) {
            return `In ${hoursUntil} ${hoursUntil === 1 ? 'hour' : 'hours'}${timeLabel}`;
        }

        // Fallback
        return dueDateTime.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            year: 'numeric'
        }).replace(/(\d{1,2}:\d{2})/, match => match.toLowerCase());
    };

    export default formatDateDifference;
    export { formatDueDateDifference };

// Absolute date for columns and chips where an age ("412d") does not answer the
// question being asked. The year is dropped inside the current year and kept
// outside it, so an old ticket can never be misread as a recent one (HTPR-5129).
export const formatDateWithYearIfPast = (value: Date | string | null | undefined): string => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    });
};
