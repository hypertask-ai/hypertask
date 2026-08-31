import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MobileAnnouncementIndicator,
  shouldShowMobileAnnouncementIndicator,
} from "../src/components/Modals/Settings/announcementIndicator";

const unread = { readAt: null };
const read = { readAt: "2026-08-31T22:00:00.000Z" };

const indicatorState = {
  announcements: [unread],
  mobile: true,
  muted: false,
  preferencesFetched: true,
};

test("mobile Settings shows the indicator for a fetched unmuted unread announcement", () => {
  assert.equal(shouldShowMobileAnnouncementIndicator(indicatorState), true);
});

test("the indicator stays hidden until preferences load and when alerts are muted", () => {
  assert.equal(
    shouldShowMobileAnnouncementIndicator({
      ...indicatorState,
      preferencesFetched: false,
    }),
    false,
  );
  assert.equal(
    shouldShowMobileAnnouncementIndicator({ ...indicatorState, muted: true }),
    false,
  );
  assert.equal(
    shouldShowMobileAnnouncementIndicator({ ...indicatorState, muted: undefined }),
    false,
  );
});

test("read announcements and desktop Settings never show the mobile indicator", () => {
  assert.equal(
    shouldShowMobileAnnouncementIndicator({
      ...indicatorState,
      announcements: [read],
    }),
    false,
  );
  assert.equal(
    shouldShowMobileAnnouncementIndicator({ ...indicatorState, mobile: false }),
    false,
  );
});

test("malformed announcement data fails closed", () => {
  assert.equal(
    shouldShowMobileAnnouncementIndicator({
      ...indicatorState,
      announcements: [null, {}],
    }),
    false,
  );
});

test("the visible indicator renders the mobile unread dot", () => {
  const visible = renderToStaticMarkup(
    React.createElement(MobileAnnouncementIndicator, { visible: true }),
  );
  const hidden = renderToStaticMarkup(
    React.createElement(MobileAnnouncementIndicator, { visible: false }),
  );

  assert.match(visible, /h-\[7px\]/);
  assert.match(visible, /bg-\[#51A4F1\]/);
  assert.equal(hidden, "");
});
