import { useInboxZero } from "@/lib/contexts/InboxZeroContext";
import { showQuickTipsAtom } from "@/store";
import { useEffect } from "react";
import { useRecoilState } from "@/lib/state";

export const useInboxZeroStyling = () => {
  const { isInboxZero } = useInboxZero();
  const [showQuickTips, setShowQuickTips] = useRecoilState(showQuickTipsAtom)

  useEffect(() => {
    if (isInboxZero) {
      setShowQuickTips(false);
    }
  }, [isInboxZero]);
  // Return conditional classes based on inbox zero state
  const getInboxZeroClasses = {
    // Text colors
    textPrimary: isInboxZero ? "text-white" : "text-gray-900 dark:text-gray-100",
    textSecondary: isInboxZero ? "text-white/90" : "text-gray-600 dark:text-gray-300",
    textMuted: isInboxZero ? "text-white/80" : "text-gray-500 dark:text-gray-400",
    
    // Background colors
    backgroundPrimary: isInboxZero ? "bg-transparent" : "bg-containerBackground",
    backgroundSecondary: isInboxZero ? "bg-white/10 backdrop-blur-sm" : "bg-hoverCardBackground",
    
    // Border colors
    borderPrimary: isInboxZero ? "border-white/20" : "border-border-labelComponent",
    borderSecondary: isInboxZero ? "border-white/10" : "border-gray-200 dark:border-gray-700",
    
    // Hover states
    hoverPrimary: isInboxZero ? "hover:bg-white/20" : "hover:bg-hoverCardBackground",
    hoverSecondary: isInboxZero ? "hover:bg-white/10" : "hover:bg-gray-50 dark:hover:bg-gray-800",
    
    // Shadow effects
    shadowPrimary: isInboxZero ? "shadow-white/20" : "shadow-gray-200 dark:shadow-gray-800",
    dropShadow: isInboxZero ? "drop-shadow-lg" : "",
    
    // Icon colors
    iconPrimary: isInboxZero ? "text-white" : "text-gray-600 dark:text-gray-400",
    iconSecondary: isInboxZero ? "text-white/80" : "text-gray-500 dark:text-gray-500",
  };

  return {
    isInboxZero,
    classes: getInboxZeroClasses,
  };
};
