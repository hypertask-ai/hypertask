import useFcmToken from "@/hooks/General/useFcmToken";
import { changePushNotificationStatus } from "@/utils/api/global/pushNotifications";
import { Info } from "lucide-react";
import { ToggleSwitch, ToggleSwitchProps } from "../Single section items";
import { useRecoilState } from "@/lib/state";
import { fcmAtom } from "@/store";
import Link from "next/link";
import { ComponentType, useState } from "react";

const PushNotificationSidebar = ({
  ToggleComponent = ToggleSwitch,
}: {
  ToggleComponent?: ComponentType<ToggleSwitchProps>;
} = {}) => {
  const [fcmData, setFcmData] = useRecoilState(fcmAtom);
  const [showLink, setShowLink] = useState<boolean>(false);
  const { retrieveToken } = useFcmToken();

  const enableOnClick = async () => {
    const result = await retrieveToken();
    if (result === undefined || result.length === 0) setShowLink(true);
  };

  const handlePushNotificationToggle = async () => {
    if (fcmData.fcmToken === undefined) return;
    if (fcmData.statusToggleFromDB === "true") {
      setFcmData((prev) => ({
        ...prev,
        statusToggleFromDB: "false",
      }));
      await changePushNotificationStatus(fcmData.fcmToken, false);
    } else if (fcmData.statusToggleFromDB === "false") {
      setFcmData((prev) => ({
        ...prev,
        statusToggleFromDB: "true",
      }));
      await changePushNotificationStatus(fcmData.fcmToken, true);
    }
  };

  return (
    <>
      {fcmData.permissionStatus === "denied" ? (
        <EnableDeviceNotification onClick={enableOnClick} showLink={showLink} />
      ) : !fcmData.fcmToken ? (
        <EnableDeviceNotification onClick={enableOnClick} showLink={showLink} />
      ) : (
        <ToggleComponent
          label="Push Notifications on this device"
          inputId="push-notifications-toggle"
          value={fcmData.statusToggleFromDB}
          checked={fcmData.statusToggleFromDB === "true"}
          onChange={handlePushNotificationToggle}
        />
      )}
    </>
  );
};

const EnableDeviceNotification = ({
  onClick,
  showLink,
}: {
  onClick: () => void;
  showLink: boolean;
}) => {
  return (
    <div className="div gap-1 flex flex-col">
      <button
        type="button"
        className="w-fit rounded-[5px] border border-border-light-gray-thin px-2 py-1 text-content font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
        onClick={onClick}
      >
        Subscribe to Device Notifications
      </button>
      {showLink && (
        <Link
          target="_blank"
          rel="noopener noreferrer"
          href={
            "https://help.hypertask.ai/en/articles/10895350-how-to-receive-notifications-from-hypertasks"
          }
          className="flex items-center text-content font-normal text-text-light-gray gap-1 hover:underline"
        >
          <Info size={18} strokeWidth={1.75} />
          <span>Notifications blocked? Enable them in your browser</span>
        </Link>
      )}
    </div>
  );
};

export default PushNotificationSidebar;
