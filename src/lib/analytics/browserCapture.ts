import { getCookieConsent } from "@/lib/cookieConsent";

type BrowserAnalyticsEvent = {
  event: "signup_page_viewed";
  properties: { event_id: string; user_id: string | null } & Record<string, string | null>;
};

type BrowserAnalyticsSink = (event: BrowserAnalyticsEvent) => void;

let identifyEventIds = false;

export function setIdentifyEventIds(enabled: boolean): void {
  identifyEventIds = enabled;
}

export function identifyEventIdsEnabled(): boolean {
  return identifyEventIds;
}

let sink: BrowserAnalyticsSink | null = null;
const queue: BrowserAnalyticsEvent[] = [];

export function captureBrowserEvent(event: BrowserAnalyticsEvent): void {
  if (getCookieConsent() === "essential") return;
  if (sink) sink(event);
  else queue.push(event);
}

export function installBrowserCaptureSink(capture: BrowserAnalyticsSink): () => void {
  sink = capture;
  queue.splice(0).forEach(capture);
  return () => {
    if (sink === capture) sink = null;
  };
}
