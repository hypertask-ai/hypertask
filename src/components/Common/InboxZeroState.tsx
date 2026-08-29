"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

interface InboxZeroStateProps {
  className?: string;
  showContent?: boolean;
}

// Desktop images - wider, more landscape-oriented
const desktopImages = [
  "https://images.pexels.com/photos/10094885/pexels-photo-10094885.jpeg",
  "https://images.pexels.com/photos/30313136/pexels-photo-30313136.jpeg",
  "https://images.pexels.com/photos/1072179/pexels-photo-1072179.jpeg",
  "https://images.pexels.com/photos/34337479/pexels-photo-34337479.jpeg",
    "https://images.pexels.com/photos/1428277/pexels-photo-1428277.jpeg",
    "https://files.hypertask.app/tasks/attachments/1761047605575pexels-alex-shanless-2770148-4312402.jpg",
    "https://files.hypertask.app/tasks/attachments/1761047605564pexels-eberhardgross-443446.WEBP",
    "https://files.hypertask.app/tasks/attachments/1761047605552pexels-philippedonn-1169754.WEBP",
    "https://files.hypertask.app/tasks/attachments/1761047605558pexels-eberhardgross-1612351.jpg",
    // "https://files.hypertask.app/tasks/attachments/1761047605568pexels-quang-nguyen-vinh-222549-2131614.jpg",
    // "https://files.hypertask.app/tasks/attachments/1761047605572pexels-katieburandt-1212693.jpg",
    // "https://files.hypertask.app/tasks/attachments/1761047605737pexels-fabianreitmeier-707915.WEBP"
//   "https://images.unsplash.com/photo-1469474968028-56623f02e42e?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80",
//   "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80",
//   "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80",
//   "https://images.unsplash.com/photo-1518837695005-2083093ee35b?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80"
];

// Mobile images - more portrait-oriented or square
const mobileImages = [
  "https://images.pexels.com/photos/34341804/pexels-photo-34341804.jpeg",
  "https://images.pexels.com/photos/1327786/pexels-photo-1327786.jpeg",
  "https://images.pexels.com/photos/11950372/pexels-photo-11950372.jpeg",
  "https://images.pexels.com/photos/2688661/pexels-photo-2688661.jpeg"
//   "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1469474968028-56623f02e42e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1518837695005-2083093ee35b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1506905925346-14b1e0dba749?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
//   "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
];

const InboxZeroState = ({ className = "", showContent = true }: InboxZeroStateProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState("");
  const [isMobile, setIsMobile] = useState(false);

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
    // Select random image based on device type
    const images = isMobile ? mobileImages : desktopImages;
    const randomIndex = Math.floor(Math.random() * images.length);
    setSelectedImage(images[randomIndex]);
    
    // Trigger animation after component mounts
    const timer = setTimeout(() => setIsVisible(true), 20);
    return () => clearTimeout(timer);
  }, [isMobile]);

  return (
    <div className={`relative w-full h-full animate-reward-entrance min-h-screen ${className}`}>
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
