/**
 * Utility functions for opening email clients with search queries
 * Opens search results for emails from hypertask.ai to help users find verification emails
 * without getting distracted by their entire inbox
 */

/**
 * Opens Gmail with a search query for emails from hypertask.ai
 */
export const openGmail = () => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  // Search query URL for emails from hypertask.ai
  const searchUrl = 'https://mail.google.com/mail/#search/hypertask.ai';

  if (isMobile) {
    // On mobile, try deep link scheme first
    // If app is installed, it will open; otherwise browser will handle it
    const deepLink = 'googlegmail://';
    
    // Create a temporary anchor to attempt deep link
    const link = document.createElement('a');
    link.href = deepLink;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Fallback to universal link with search query (works on both web and app)
    setTimeout(() => {
      window.location.href = searchUrl;
    }, 250);
  } else {
    // Desktop - open Gmail search in new tab
    window.open(searchUrl, '_blank');
  }
};

/**
 * Opens Outlook with a search query for emails from hypertask.ai
 */
export const openOutlook = () => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  // Search query URL for emails from hypertask.ai
  const searchUrl = 'https://outlook.live.com/mail/0/inbox?searchQuery=hypertask.ai';

  if (isMobile) {
    // On mobile, try deep link scheme first
    // If app is installed, it will open; otherwise browser will handle it
    const deepLink = 'ms-outlook://';
    
    // Create a temporary anchor to attempt deep link
    const link = document.createElement('a');
    link.href = deepLink;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Fallback to universal link with search query (works on both web and app)
    setTimeout(() => {
      window.location.href = searchUrl;
    }, 250);
  } else {
    // Desktop - open Outlook search in new tab
    window.open(searchUrl, '_blank');
  }
};

