// eslint-disable-next-line no-undef
importScripts('https://www.gstatic.com/firebasejs/9.20.0/firebase-app-compat.js');
// eslint-disable-next-line no-undef
importScripts('https://www.gstatic.com/firebasejs/9.20.0/firebase-messaging-compat.js');


// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.onmessage = event => {
//     if (event.data.messageType === 'notification-clicked') {
//       window.location.href = event.notification.data.FCM_MSG.notification.click_action;
//       // var a = window.open("", event.data.notification.click_action);
//       // a.focus();
//     }
//    };
// }
// Activate a new service worker version immediately instead of waiting for all
// tabs/PWA windows to close — otherwise a click-handler fix never reaches an
// installed PWA that stays open.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));


self.addEventListener('notificationclick', function (event) {
  // Own the click: stop firebase-compat's default handler (registered below,
  // when messaging() initializes) from also opening a second window.
  event.stopImmediatePropagation();
  event.notification.close();

  // The deep link is the click_action we send in the message `data`. When the
  // firebase compat SW auto-displays a notification it nests the original
  // payload under FCM_MSG, so read from there first, with fallbacks.
  const data = (event.notification && event.notification.data) || {};
  const msg = data.FCM_MSG || {};
  const url =
    (msg.data && msg.data.click_action) ||
    (msg.notification && msg.notification.click_action) ||
    (msg.fcmOptions && msg.fcmOptions.link) ||
    data.click_action ||
    data.link;

  event.waitUntil(
    clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function (windowClients) {
      // This worker runs under firebase's own SW scope, so it does NOT control
      // the app windows and cannot client.navigate() them (that rejects). So:
      // focus an open same-origin window and hand it the URL to navigate itself
      // (page-side listener in useFcmToken); otherwise open a fresh window.
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        var sameOrigin = client.url && client.url.indexOf(self.location.origin) === 0;
        if (sameOrigin && 'focus' in client) {
          if (url) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: url });
          }
          return client.focus();
        }
      }
      // Nothing open yet: open a new window at the task.
      if (url && clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
const firebaseConfig = {
  
  apiKey: "AIzaSyD1YIaE-4HHzsjRpRYe2rJyeTPMbSENnQc",
    authDomain: "hypertasks-403606.firebaseapp.com",
    projectId: "hypertasks-403606",
    storageBucket: "hypertasks-403606.appspot.com",
    messagingSenderId: "992767949049",
    appId: "1:992767949049:web:104858eb42536da2f94a28",
    measurementId: "G-WT9Y8VS5P8"
    
  };
  
firebase.initializeApp(firebaseConfig);



const messaging = firebase.messaging();

  // console.log("🚀 ~ file: firebase-messaging-sw.js:80 ~ navigator:", navigator, messaging)
  // messaging.onBackgroundMessage((payload) => {
  //   console.log(
  //     '[firebase-messaging-sw.js] Received background message ',
  //     payload
  //   );
  //   // const notificationTitle = payload.notification.title;
  //   // const notificationOptions = {
  //   //   body: notificationTitle,
  //   //   icon: 'logo.png',
  //   // };
  //   // self.registration.showNotification(notificationTitle, notificationOptions);
  // });
