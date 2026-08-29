import crypto from "crypto";

/**
 *Function for sending Signup event to Meta
 *client info includes ip addresses and stuff
 * @export
 * @param {string} user_email
 * @param {*} clientInfo
 * @return {*}
 *
 */
export async function sendMetaCAPIEvent(
  user_email: string,
  clientInfo: any,
  event_name: "Lead" | "Sale"
) {
  const isDev = process.env.NEXT_PUBLIC_BASEURL === "http://localhost:3000";
  if (isDev) return;
  const API_VERSION = "v23.0";
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error("Meta CAPI environment variables not set.");
    return;
  }

  const eventId = `lead_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 8)}`;

  const hashedEmail = crypto
    .createHash("sha256")
    .update(user_email.toLowerCase())
    .digest("hex");

  const eventsData = [
    {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_source_url: clientInfo.currentBrowserUrl,
      event_id: eventId,
      user_data: {
        em: hashedEmail,
        client_ip_address: clientInfo.ipAddress,
        client_user_agent: clientInfo.userAgent,
        fbp: clientInfo._fbp,
        fbc: clientInfo._fbc,
      },
    },
  ];
  console.log("🤔 ~ sendMetaCAPIEvent ~ eventsData:", eventsData);

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: eventsData }),
  };

  const metaApiUrl = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  fetch(metaApiUrl, options)
    .then((response) => response.json())
    .then((response) => {
      if (response.events_received) {
        console.log("Meta CAPI event sent successfully:", response);
      } else {
        console.error("Failed to send Meta CAPI event:", response);
      }
    })
    .catch((err) => console.error("Error sending Meta CAPI event:", err));
}
