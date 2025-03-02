import { browser } from "../browser.ts";
import { addMessageFromTabListeners } from "../messages.ts";

export function main() {
  addMessageFromTabListeners({
    "notify-blocked-result-count"(tabId: number, count: number) {
      const action =
        process.env.BROWSER === "chrome"
          ? browser.action
          : browser.browserAction;
      action.setBadgeText({
        tabId,
        text: count ? String(count) : "",
      });
    },
  });
}
