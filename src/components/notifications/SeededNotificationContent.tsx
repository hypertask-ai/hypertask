"use client";

import * as projection from "@/lib/firstScreen/comment";
import { NotificationContentBody } from "./NotificationRow";

export default function SeededNotificationContent() {
    return <NotificationContentBody projection={projection} />;
}
