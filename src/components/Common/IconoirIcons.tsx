// Iconoir glyphs (viewBox 0 0 24 24, stroke-based). Paths copied verbatim from Iconoir's
// SVG source (i-ic-* symbol defs), attrs converted to camelCase JSX props.
// See HTPR-4931.

interface IconoirIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function IconoirSidebar({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.25 10L5.5 12L7.25 14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 21V3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirKanban({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M12 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H12M12 3H3.6C3.26863 3 3 3.26863 3 3.6V20.4C3 20.7314 3.26863 21 3.6 21H12M12 3V21" stroke="currentColor" />
    </svg>
  );
}

export function IconoirRows({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M3 12H7.5H12H16.5H21M3 12V16.5M3 12V7.5M21 12V16.5M21 12V7.5M3 16.5V20.4C3 20.7314 3.26863 21 3.6 21H7.5H12H16.5H20.4C20.7314 21 21 20.7314 21 20.4V16.5M3 16.5H7.5H12H16.5H21M21 7.5V3.6C21 3.26863 20.7314 3 20.4 3H16.5H12H7.5H3.6C3.26863 3 3 3.26863 3 3.6V7.5M21 7.5H16.5H12H7.5H3" stroke="currentColor" />
    </svg>
  );
}

export function IconoirCalendar({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M15 4V2M15 4V6M15 4H10.5M3 10V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V10H3Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 10V6C3 4.89543 3.89543 4 5 4H7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 2V6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 10V6C21 4.89543 20.1046 4 19 4H18.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirSparks({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M8 15C12.8747 15 15 12.949 15 8C15 12.949 17.1104 15 22 15C17.1104 15 15 17.1104 15 22C15 17.1104 12.8747 15 8 15Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M2 6.5C5.13376 6.5 6.5 5.18153 6.5 2C6.5 5.18153 7.85669 6.5 11 6.5C7.85669 6.5 6.5 7.85669 6.5 11C6.5 7.85669 5.13376 6.5 2 6.5Z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirSearch({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M17 17L21 21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirUserPlus({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M17 10H20M23 10H20M20 10V7M20 10V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 20V19C1 15.134 4.13401 12 8 12V12C11.866 12 15 15.134 15 19V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirRocket({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M16.0614 10.4037L14 17L10 17L7.93865 10.4037C7.35085 8.52273 7.72417 6.47307 8.93738 4.92015L11.5272 1.6052C11.7674 1.29772 12.2326 1.29772 12.4728 1.6052L15.0626 4.92015C16.2758 6.47307 16.6491 8.52273 16.0614 10.4037Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 20C10 22 12 23 12 23C12 23 14 22 14 20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 12.5C5 15 7 19 7 19L10 17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.9312 12.5C19.4312 15 17.4312 19 17.4312 19L14.4312 17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11C10.8954 11 10 10.1046 10 9C10 7.89543 10.8954 7 12 7C13.1046 7 14 7.89543 14 9C14 10.1046 13.1046 11 12 11Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirChat({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M17 12.5C17.2761 12.5 17.5 12.2761 17.5 12C17.5 11.7239 17.2761 11.5 17 11.5C16.7239 11.5 16.5 11.7239 16.5 12C16.5 12.2761 16.7239 12.5 17 12.5Z" fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z" fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 12.5C7.27614 12.5 7.5 12.2761 7.5 12C7.5 11.7239 7.27614 11.5 7 11.5C6.72386 11.5 6.5 11.7239 6.5 12C6.5 12.2761 6.72386 12.5 7 12.5Z" fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoirSettings({ size = 18, strokeWidth = 1.5, className }: IconoirIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
    >
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
