import axios from "axios";
import { useState, useEffect } from "react";
import { ToggleSwitch } from "../Single section items";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { cn } from "@/utils/undoActions/helperFuncs";
type NotificationLevel = "all" | "direct" | "nothing";

const MentionNotificationSidebar = () => {
    const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
    const [notificationLevel, setNotificationLevel] = useState<NotificationLevel>(currentUser?.notificationPreference || currentUser?.UserSetting?.notificationPreference);
    const [loading, setLoading] = useState(false);
  
    useEffect(() => {
      // Load initial notification preference from user data
      // Check flattened property first, then fallback to nested UserSetting
      const preference = currentUser?.notificationPreference || currentUser?.UserSetting?.notificationPreference;
      if (preference) {
        setNotificationLevel(preference);
      }
    }, [currentUser]);
  
    const handleNotificationChange = async (value: NotificationLevel) => {
      setNotificationLevel(value);
      setLoading(true);
  
      try {
        // Update on backend
        await axios.post("/api/notifications/preference", {
          notificationLevel: value,
        });
  
        // Update local state
        setCurrentUser((prev:any) => ({
          ...prev,
          notificationPreference: value,
        }));
      } catch (error) {
        console.error("Failed to update notification preference:", error);
        // Revert on error
        setNotificationLevel(currentUser?.notificationPreference || "direct");
      } finally {
        setLoading(false);
      }
    };
  
    const options: { value: NotificationLevel; label: string; description: string }[] = [
      {
        value: "all",
        label: "All new messages",
        description: "Get notified for every message",
      },
      {
        value: "direct",
        label: "Only @mentions",
        description: "Only notify for @ Mentions",
      },
      {
        value: "nothing",
        label: "Nothing",
        description: "Disable all notifications",
      },
    ];
  
    return (
      <div className="space-y-3 text-content">
        <fieldset disabled={loading} className="space-y-3">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                name="notification-level"
                value={option.value}
                checked={notificationLevel === option.value}
                onChange={(e) =>
                  handleNotificationChange(e.target.value as NotificationLevel)
                }
                className={cn("w-3 h-3 cursor-pointer appearance-none rounded-full !border-thin border-text-light-gray bg-transparent checked:border-white-black fill-white", 
                  notificationLevel === option.value ? "dark:bg-white bg-[#202124] p-1" : "bg-transparent")}
                
              />
              <span className="text-content font-normal text-white-black">{option.label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    );
  };
export default MentionNotificationSidebar;
