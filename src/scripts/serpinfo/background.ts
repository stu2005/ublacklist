import {
  loadFromRawStorage,
  modifyInRawStorage,
} from "../background/raw-storage.ts";
import { syncDelayed } from "../background/sync.ts";
import { browser } from "../browser.ts";
import {
  addMessageFromTabListeners,
  addMessageListeners,
} from "../messages.ts";
import { HTTPError } from "../utilities.ts";
import {
  type SerpInfoSettings,
  addRemote,
  mergeBuiltins,
  removeRemote,
  setEnabled,
  setRemoteDownloaded,
  setRemoteEnabled,
  setUser,
} from "./settings.ts";

function modifySettings(
  modify: (settings: Readonly<SerpInfoSettings>) => SerpInfoSettings,
): Promise<void> {
  return modifyInRawStorage(["serpInfoSettings"], ({ serpInfoSettings }) => ({
    serpInfoSettings: modify(serpInfoSettings),
  }));
}

async function updateRemote(url: string) {
  let textOrError: string | Error;
  try {
    const response = await fetch(url);
    textOrError = response.ok
      ? await response.text()
      : new HTTPError(response.status, response.statusText);
  } catch (e) {
    textOrError = e instanceof Error ? e : new Error("Unknown error");
  }
  await modifySettings((settings) =>
    typeof textOrError === "string"
      ? setRemoteDownloaded(settings, url, textOrError, null)
      : setRemoteDownloaded(settings, url, null, textOrError.message),
  );
}

export async function updateAllRemote() {
  const { serpInfoSettings } = await loadFromRawStorage(["serpInfoSettings"]);
  if (!serpInfoSettings.enabled) {
    return;
  }
  await Promise.all(
    serpInfoSettings.remote.map((r) =>
      r.enabled ? updateRemote(r.url) : Promise.resolve(),
    ),
  );
}

export async function onStartup() {
  const UPDATE_ALARM_NAME = "update-all-remote-serpinfo";
  const UPDATE_INTERVAL = 60 * 24; // 1 day

  await modifySettings(mergeBuiltins);
  if (!(await browser.alarms.get(UPDATE_ALARM_NAME))) {
    void updateAllRemote();
    await (browser.alarms.create(UPDATE_ALARM_NAME, {
      periodInMinutes: UPDATE_INTERVAL,
    }) as unknown as Promise<void>);
  }
}

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
  addMessageListeners({
    async "enable-serpinfo"(enabled: boolean) {
      await modifySettings((settings) =>
        setEnabled(settings, enabled, new Date()),
      );
      syncDelayed({ serpInfo: true });
      if (enabled) {
        await updateAllRemote();
      }
    },
    async "set-user-serpinfo"(userInput: string) {
      await modifySettings((settings) =>
        setUser(settings, userInput, new Date()),
      );
      syncDelayed({ serpInfo: true });
    },
    async "add-remote-serpinfo"(url: string) {
      await modifySettings((settings) => addRemote(settings, url, new Date()));
      syncDelayed({ serpInfo: true });
      void updateRemote(url);
    },
    async "remove-remote-serpinfo"(url: string) {
      await modifySettings((settings) =>
        removeRemote(settings, url, new Date()),
      );
      syncDelayed({ serpInfo: true });
    },
    async "enable-remote-serpinfo"(url: string, enabled: boolean) {
      await modifySettings((settings) =>
        setRemoteEnabled(settings, url, enabled, new Date()),
      );
      syncDelayed({ serpInfo: true });
      if (enabled) {
        void updateRemote(url);
      }
    },
    "update-remote-serpinfo"(url: string) {
      void updateRemote(url);
    },
    "update-all-remote-serpinfo"() {
      void updateAllRemote();
    },
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "update-all-remote-serpinfo") {
      void updateAllRemote();
    }
  });
}
