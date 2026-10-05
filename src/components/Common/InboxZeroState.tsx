"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

interface InboxZeroStateProps {
  className?: string;
  showContent?: boolean;
}

import { selectInboxZeroImage } from "@/lib/firstScreen/inboxZero";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";

const InboxZeroState = ({ className = "", showContent = true }: InboxZeroStateProps) => {
  const snapshot = useFirstScreenSurface();
  const document = getInboxDocument(snapshot, snapshot?.scope.accountId ?? 0);
  const [initialImage] = useState(() => document?.data.zeroImage ?? null);
  const [isVisible, setIsVisible] = useState(Boolean(initialImage));
  const [selectedImage, setSelectedImage] = useState(initialImage ?? "");
  const [isMobile, setIsMobile] = useState(document?.display ? (document.display as { isMobile?: boolean }).isMobile ?? false : false);

  useEffect(() => {
    // Detect if mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (initialImage) return;
    setSelectedImage(selectInboxZeroImage(isMobile));
    
    // Trigger animation after component mounts
    const timer = setTimeout(() => setIsVisible(true), 20);
    return () => clearTimeout(timer);
  }, [isMobile, initialImage]);

  return (
    <div className={`relative w-full h-full ${initialImage ? "" : "animate-reward-entrance"} min-h-screen ${className}`}>
      {/* Background Image with smooth entrance */}
      {/* Using next/image for the background image if selectedImage is set */}
      {selectedImage && (
        <Image
          src={selectedImage}
          alt="Inbox zero reward background"
          fill
          priority
          style={{
            objectFit: "cover",
            objectPosition: "top",
            zIndex: 0,
          }}
          className="absolute inset-0 w-full h-full select-none pointer-events-none transition-opacity duration-700"
          sizes="100vw"
        />
      )}
      
      {/* Dark overlay for better text readability with smooth transition */}
      <div className="absolute inset-0 bg-black/40 animate-gentle-glow" />
      
      {/* Content overlay - only show if showContent is true */}
      {showContent && (
        <div
          className={`relative z-10 flex flex-col items-center justify-center min-h-screen py-20 px-8 text-center transition-all duration-1200 ease-out ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
        >
          {/* Achievement text with white text for contrast */}
          <div className="space-y-6  px-10 py-2 text-6xl  rounded  text-white/70 ">
            INBOX ZERO
          </div>

        </div>
      )}
    </div>
  );
};

export default InboxZeroState;
