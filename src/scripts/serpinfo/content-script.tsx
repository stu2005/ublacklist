import isMobile from "is-mobile";
import { MatchPatternMap } from "../../common/match-pattern.ts";
import { filter } from "./filter.ts";
import { storageStore } from "./storage-store.ts";
import { setupPopupListeners, style } from "./style.ts";
import type { CompiledSerpInfo } from "./types.ts";
import type { SerpDescription } from "./types.ts";

function getSerpDescriptions(
  compiledSerpInfo: CompiledSerpInfo,
  url: string,
  mobile: boolean,
): SerpDescription[] {
  return new MatchPatternMap<number>(compiledSerpInfo.urlToSerpIndices)
    .get(url)
    .flatMap((index) => {
      const serp = compiledSerpInfo.serps[index];
      if (!serp) {
        return [];
      }
      if (serp.excludeMatches) {
        const excludeMap = new MatchPatternMap<1>();
        for (const match of serp.excludeMatches) {
          excludeMap.set(match, 1);
        }
        if (excludeMap.get(url).length) {
          return [];
        }
      }
      if (
        (serp.userAgent === "desktop" && mobile) ||
        (serp.userAgent === "mobile" && !mobile)
      ) {
        return [];
      }
      return [serp];
    });
}

function awaitBody(callback: () => void) {
  if (document.body) {
    callback();
  } else {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        callback();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }
}

function awaitLoad(delay: number, callback: () => void) {
  if (document.readyState === "complete") {
    callback();
  } else {
    window.addEventListener("load", () => {
      window.setTimeout(callback, delay);
    });
  }
}

storageStore.attachPromise.then(() => {
  const state = storageStore.getState();
  if (!storageStore.getState().enableSerpInfo) {
    return;
  }

  const serps = getSerpDescriptions(
    state.compiledSerpInfo,
    window.location.href,
    isMobile({ tablet: true }),
  );
  if (serps.length === 0) {
    return;
  }

  setupPopupListeners();

  const start = () => {
    style();
    filter(serps);
  };
  const delay = Math.max(
    ...serps.map(({ delay }) =>
      typeof delay === "number" ? delay : delay ? 0 : -1,
    ),
  );
  if (delay < 0) {
    awaitBody(start);
  } else {
    awaitLoad(delay, start);
  }
});
