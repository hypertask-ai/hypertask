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
];

// Mobile images - more portrait-oriented or square
const mobileImages = [
  "https://images.pexels.com/photos/34341804/pexels-photo-34341804.jpeg",
  "https://images.pexels.com/photos/1327786/pexels-photo-1327786.jpeg",
  "https://images.pexels.com/photos/11950372/pexels-photo-11950372.jpeg",
  "https://images.pexels.com/photos/2688661/pexels-photo-2688661.jpeg"
];

export function selectInboxZeroImage(isMobile: boolean) {
  const images = isMobile ? mobileImages : desktopImages;
  return images[Math.floor(Math.random() * images.length)];
}
