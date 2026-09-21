import { useCallback, useEffect, useState } from 'react';
import { addDevice } from '@/utils/api/users';
import { fetchPushNotificationStatus } from '@/utils/api/global/pushNotifications';
import { useRecoilState } from '@/lib/state';
import { currentUserAtom,fcmAtom } from '@/store';
import { prefixKeyUseGetPushStatus, useGetPushNotificationStatus } from '../MultiPages/Sidebar/useGetPushNotificationStatus';
import {  useQueryClient } from '@tanstack/react-query';

const useFcmToken = () => {

  const [currentUser,_] = useRecoilState(currentUserAtom);
  const [notificationPermissionStatus, setNotificationPermissionStatus] =useState('');
  const [token, setToken ] = useState("")
  const [fcmData, setFcmData] = useRecoilState(fcmAtom);

  const queryClient = useQueryClient();   

  useGetPushNotificationStatus(token)

  // The FCM service worker runs under its own scope and can't navigate our
  // windows, so on a notification click it focuses this window and posts the
  // deep link here. Navigate the open app to the task (scrolls to the comment).
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICK" && event.data.url) {
        window.location.assign(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // asks the browser for permission
    const retrieveToken = async () => {
      try {
            if (typeof window !== 'undefined' && 'serviceWorker' in navigator && currentUser?.id) {
          const [{ getMessaging, getToken, isSupported }, { app }] = await Promise.all([
            import('firebase/messaging'),
            import('@/firebase'),
          ]);
          // Browsers without Push/SW support throw messaging/unsupported-browser (HTPR-4727)
          if (!(await isSupported())) return;
          const messaging = getMessaging(app);
          
          // Retrieve the notification permission status
          const result = await window.Notification.requestPermission();
          console.error("🚀 ~  useFcmToken ~ retrieveToken ~ result:", result)
          setNotificationPermissionStatus(result);

          // Check if permission is granted before retrieving the token
          if (result === 'granted') {
            const currentToken = await getToken(messaging, {
              vapidKey:
                process.env.NEXT_PUBLIC_VAPID_KEY,
            });
            
            // permission is granted and the token has been retrieved, 
            // set the following:
            // 1: setFcmData( fcmToken, permissionStatus)
            // 2: Add the device into DB.
            // 3: get the push status and setFcmData(statusToggleFromDB)
            if (currentToken) {
              setTokenAndGetPushStatus(currentToken, result)
              return currentToken
              
            } else {
              console.error(
                'No registration token available. Request permission to generate one.'
              );
            }
          }
          // if not, reset the queryClient, and reset SetData as well
          else resetData(result)
        }
      } catch (error) {
        console.error('An error occurred while retrieving token:', error);
      }
    };

    const resetData = ( permissionStatus:NotificationPermission )=>{
      queryClient.removeQueries({queryKey:[prefixKeyUseGetPushStatus,"found"]})
      setFcmData({statusToggleFromDB:"false",fcmToken:undefined, permissionStatus})

    }
    const setTokenAndGetPushStatus = async(fcmToken:string, permissionStatus:NotificationPermission )=>{
      try{
        setFcmData((prev)=>({...prev, fcmToken, permissionStatus}))
        setToken(fcmToken)
        await addDevice(fcmToken)
        getPushStatus(fcmToken)
      } catch(error){
        console.log("🤔 ~ setTokenAndGetPushStatus ~ error:", error)
      }
      

    }

    const getPushStatus = async (tokenToCheck:string) => {
      if (tokenToCheck) {
        const response = await fetchPushNotificationStatus(tokenToCheck)
        // setStatusToggleLocal(response.sendNotifications ? "true" : "false")
        setFcmData((prev)=>({...prev, statusToggleFromDB:response?.sendNotifications ? "true" : "false"}))
      }
    }

  return { fcmToken: fcmData.fcmToken, notificationPermissionStatus, retrieveToken,statusToggleFromDB:fcmData.statusToggleFromDB };
};

export default useFcmToken;
