"use client";

import React, { useState } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import Image from "next/image";
import logo from "@/assets/RightSidebarLogo.webp";
import axios from "axios";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";

interface InteractiveTutorialMobileBlockingProps {
  onDismiss: () => void;
}

/**
 * Interactive Tutorial Mobile Blocking Overlay
 * 
 * Displays when mobile users attempt to access the interactive tutorial.
 * Guides them to desktop where the tutorial works properly.
 */
export const InteractiveTutorialMobileBlocking: React.FC<InteractiveTutorialMobileBlockingProps> = ({
  onDismiss,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const router = useRouter();
  const currentUser = useCurrentUser();
  const userEmail = currentUser?.email || "";

  const handleSendDesktopLink = async () => {
    if (!userEmail) {
      toast.error("Please log in to receive a desktop link.");
      return;
    }

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
    // Redirect back to the board
    router.push("/");
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
          This Tutorial Works Best on Desktop
        </h1>

        {/* Body */}
        <div className="text-gray-300 text-emphasis sm:text-subheading mb-8 space-y-4">
          <p className="leading-relaxed">
            The interactive tutorial requires a desktop browser for the full experience.
          </p>

          <p className="text-content text-gray-400">
            On desktop, you&apos;ll be able to:
          </p>

          <ul className="text-left space-y-3 pl-1">
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                Use keyboard shortcuts for faster navigation
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                Experience the full interactive tutorial flow
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-purple-400 mt-1 flex-shrink-0">✓</span>
              <span>
                Access all features demonstrated in the tutorial
              </span>
            </li>
          </ul>
        </div>

        {/* Primary CTA */}
        {userEmail ? (
          <>
            {!emailSent ? (
              <button
                onClick={handleSendDesktopLink}
                disabled={isLoading}
                className={cn(
                  "w-full max-w-md py-3 px-6",
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
                  "Email Me a Desktop Link"
                )}
              </button>
            ) : (
              <div
                className={cn(
                  "w-full max-w-md py-4 px-6 mb-6",
                  "bg-green-600/20 !border-thin border-green-500/50",
                  "text-green-400 font-semibold text-subheading",
                  "rounded-xl"
                )}
              >
                ✓ Email sent! Check your inbox.
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-400 text-content mb-6">
            Please log in to receive a desktop link.
          </p>
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
          Go back to board
        </button>

        {/* Additional context */}
        <p className="text-meta text-gray-500 mt-6">
          The interactive tutorial is designed for desktop browsers only.
        </p>
      </div>
    </div>
  );
};
