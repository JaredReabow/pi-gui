import { test, expect } from "@playwright/test";
import { notificationSettingsTarget } from "../../electron/platform/notification-permission";

test("Windows notification recovery targets Windows Settings, never Apple documentation", () => {
  expect(notificationSettingsTarget("win32")).toBe("ms-settings:notifications");
});
