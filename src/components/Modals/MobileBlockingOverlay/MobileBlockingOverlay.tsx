"use client";

import React, { useState } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import Image from "next/image";
import logo from "@/assets/RightSidebarLogo.webp";
import axios from "axios";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

interface MobileBlockingOverlayProps {
  userEmail: string;
  onDismiss: () => void;
}

/**
 * Mobile Blocking Overlay
 * 
 * Displays after mobile signup to guide users to desktop experience
 * where they can access the AI Task Writer and interactive tutorial.
 */
export const MobileBlockingOverlay: React.FC<MobileBlockingOverlayProps> = ({
  userEmail,
  onDismiss,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const router = useRouter();

  const handleSendDesktopLink = async () => {
    setIsLoading(true);
    try {
      const response = await axios.post("/api/auth/send-desktop-link", {
        email: userEmail,
      });

      if (response.status === 200) {
        setEmailSent(true);
        toast.success("Desktop login link sent! Check your email.");
      }
    } catch (error) {
      console.error("Error sending desktop link:", error);
      toast.error("Failed to send email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismiss = () => {
    onDismiss();
    // Redirect to the stored URL or default to home
    const redirectUrl = sessionStorage.getItem('postSignupRedirect') || '/';
    sessionStorage.removeItem('postSignupRedirect');
    router.push(redirectUrl);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999]",
        "bg-gradient-dark",
        "flex items-center justify-center",
      )}
    >
      <div
        className={cn(
          "w-full h-full",
          "bg-gradient-dark",
          "!border-thin border-border-light-gray-thin",
          "shadow-2xl",
          "p-8 sm:p-10",
          "flex flex-col items-center",
          "text-center",
          "relative"
        )}
      >
        {/* Logo */}
        <div className="mb-6">
          <Image
            src={logo}
            alt="Hypertask logo"
            width={180}
            height={28}
            className="object-contain"
          />
        </div>

        {/* Headline */}
        <h1
          className={cn(
            "text-heading sm:text-display font-bold",
            "text-white mb-4",
            "leading-tight"
          )}
        >
          Your AI Assistant is Waiting on Desktop
        </h1>

        {/* Body */}
        <div className="text-gray-300 text-emphasis sm:text-subheading mb-8 space-y-4">
          <p className="leading-relaxed">
            You&apos;ve unlocked your account. Now, switch to desktop to
            experience:
          </p>

          <ul className="text-left space-y-3 pl-1">
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                <strong className="text-white">The AI Task Writer:</strong>{" "}
                Dictate tasks in seconds and let AI do the writing.
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                <strong className="text-white">
                  The Interactive Tutorial:
                </strong>{" "}
                A 3-minute guide to 10x your team&apos;s speed.
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                <strong className="text-white">A Full Kanban Board:</strong>{" "}
                Manage complex projects with a complete view.
              </span>
            </li>
          </ul>
        </div>

        {/* Primary CTA */}
        {!emailSent ? (
          <button
            onClick={handleSendDesktopLink}
            disabled={isLoading}
            className={cn(
              "w-full py-3 px-6",
              "bg-purple-900",
              "text-white font-semibold text-subheading",
              "rounded",
              "transition-all duration-200",
              "shadow-lg hover:shadow-xl",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "mb-6"
            )}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              "Email Me a Link for Desktop"
            )}
          </button>
        ) : (
          <div
            className={cn(
              "w-full py-4 px-6 mb-6",
              "bg-green-600/20 border border-green-500/50",
              "text-green-400 font-semibold text-subheading",
              "rounded-xl"
            )}
          >
            ✓ Email sent! Check your inbox.
          </div>
        )}

        {/* Subtle Secondary CTA */}
        <button
          onClick={handleDismiss}
          className={cn(
            "text-content text-gray-400",
            "hover:text-gray-300",
            "transition-colors duration-200",
            "underline"
          )}
        >
          Continue with limited mobile version
        </button>

        {/* Additional context */}
        <p className="text-meta text-gray-500 mt-6">
          Mobile access is limited to viewing and basic task management.
        </p>
      </div>
    </div>
  );
};
