    const formatDateDifference = (createdAt: string|Date | null, reminder?: boolean) => {
        if (!createdAt) return
        const currentTime = new Date();
        const notificationTime = new Date(createdAt);
        
        var timeDifference:number;
        if (reminder){
            timeDifference = (notificationTime.getTime() - currentTime.getTime()) / 1000;
        }
        else {
            timeDifference = (currentTime.getTime() - notificationTime.getTime()) / 1000;
        }
      
        if (timeDifference < 60&& !reminder ) {
          return `Just now`;
        } else if (timeDifference < 3600 && !reminder) {
          const minutes = Math.floor(timeDifference / 60);
          return `${minutes}min`;
        } else if (timeDifference < 43200) {
          return notificationTime.toLocaleString('en-US', { hour: "numeric", minute: "numeric", hour12: true });
        } else {
          if (reminder) {
            return notificationTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
          } else {
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

        const formatTime = (date: Date) => {
            return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
        };
        
        const timeDifference = dueDateTime.getTime() - currentTime.getTime();

        if (timeDifference < 0) {
            const daysOverdue = Math.floor(Math.abs(timeDifference) / (1000 * 60 * 60 * 24));
            const hoursOverdue = Math.floor(Math.abs(timeDifference) / (1000 * 60 * 60));
            const timeLabel = `, ${formatTime(dueDateTime)}`;
            
            if (daysOverdue === 0) {
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

        const daysUntil = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
        const hoursUntil = Math.floor(timeDifference / (1000 * 60 * 60));
        const timeLabel = `, ${formatTime(dueDateTime)}`;

        const today = new Date(currentTime.getFullYear(), currentTime.getMonth(), currentTime.getDate());
        const dueDateOnly = new Date(dueDateTime.getFullYear(), dueDateTime.getMonth(), dueDateTime.getDate());

        if (dueDateOnly.getTime() === today.getTime()) {
            return `Today${timeLabel}`;
        }

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (dueDateOnly.getTime() === tomorrow.getTime()) {
            return `Tomorrow${timeLabel}`;
        }

        if (daysUntil > 0 && daysUntil <= 7) {
            return `In ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}${timeLabel}`;
        }

        if (daysUntil > 7) {
            return dueDateTime.toLocaleString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                year: daysUntil > 365 ? 'numeric' : undefined
            }).replace(',', '')
            .replace(/(\d{1,2}:\d{2})/, match => match.toLowerCase());
        }

        if (hoursUntil > 0) {
            return `In ${hoursUntil} ${hoursUntil === 1 ? 'hour' : 'hours'}${timeLabel}`;
        }

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
