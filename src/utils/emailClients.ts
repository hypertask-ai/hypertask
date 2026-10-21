
export const openGmail = () => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const searchUrl = 'https://mail.google.com/mail/#search/hypertask.ai';

  if (isMobile) {
    const deepLink = 'googlegmail://';
    
    const link = document.createElement('a');
    link.href = deepLink;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      window.location.href = searchUrl;
    }, 250);
  } else {
    window.open(searchUrl, '_blank');
  }
};

export const openOutlook = () => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const searchUrl = 'https://outlook.live.com/mail/0/inbox?searchQuery=hypertask.ai';

  if (isMobile) {
    const deepLink = 'ms-outlook://';
    
    const link = document.createElement('a');
    link.href = deepLink;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      window.location.href = searchUrl;
    }, 250);
  } else {
    window.open(searchUrl, '_blank');
  }
};

