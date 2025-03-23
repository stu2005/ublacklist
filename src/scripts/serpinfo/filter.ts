import { isEqual } from "es-toolkit";
import { shallow } from "zustand/vanilla/shallow";
import icon from "../../icons/icon.svg";
import { InteractiveRuleset } from "../interactive-ruleset.ts";
import { postMessage } from "../messages.ts";
import type { PlainRuleset, Subscriptions } from "../types.ts";
import { fromPlainRuleset } from "../utilities.ts";
import { svgToDataURL } from "../utilities.ts";
import {
  type PropertyCommand,
  runButtonCommand,
  runPropertyCommand,
  runRootsCommand,
} from "./commands.ts";
import * as C from "./constants.ts";
import { closeDialog, openDialog } from "./dialog.tsx";
import { storageStore } from "./storage-store.ts";
import type { Result, ResultDescription, SerpDescription } from "./types.ts";

function getRoots(desc: ResultDescription): Element[] {
  try {
    return runRootsCommand(desc.root);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function getURL(root: Element, command: PropertyCommand): string | null {
  try {
    const url = runPropertyCommand({ root, url: true }, command);
    if (url == null) {
      return null;
    }
    new URL(url);
    return url;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function getProperty(root: Element, command: PropertyCommand): string | null {
  try {
    return runPropertyCommand({ root, url: false }, command);
  } catch (error) {
    console.error(error);
    return null;
  }
}

function getResult(
  root: Element,
  description: ResultDescription,
  serpDescription: SerpDescription,
): Result | null {
  const url = getURL(root, description.url);
  if (!url) {
    return null;
  }
  const props: Record<string, string> = {
    ...(serpDescription.commonProps || {}),
  };
  for (const [name, propDesc] of Object.entries(description.props || {})) {
    const prop = getProperty(root, propDesc);
    if (prop != null) {
      props[name] = prop;
    }
  }
  return { root, url, props, removeButton: null, description, serpDescription };
}

function addButton(
  root: Element,
  iconSource: string,
  iconSize: number,
  onClick: () => void,
  description: ResultDescription,
): (() => void) | null {
  try {
    return runButtonCommand(
      { root, iconSource, iconSize, onClick },
      description.button || ["inset", { top: 0, right: 0 }],
    );
  } catch (error) {
    console.error(error);
    return null;
  }
}

function createInteractiveRuleset(
  blacklist: string,
  ruleset: PlainRuleset | null,
  subscriptions: Subscriptions,
): InteractiveRuleset {
  return new InteractiveRuleset(
    fromPlainRuleset(ruleset || null, blacklist),
    Object.values(subscriptions)
      .filter((subscription) => subscription.enabled ?? true)
      .map(({ ruleset, blacklist, name }) => ({
        name,
        ruleset: fromPlainRuleset(ruleset || null, blacklist),
      })),
  );
}

class Filter {
  constructor(serpDescriptions: readonly SerpDescription[]) {
    this.#serpDescriptions = serpDescriptions;
    const state = storageStore.getState();
    this.#ruleset = createInteractiveRuleset(
      state.blacklist,
      state.ruleset || null,
      state.subscriptions,
    );
    this.#observer = new MutationObserver((records) =>
      this.#onMutation(records),
    );
    this.#results = new Map();
    this.#blockedResultCount = 0;

    storageStore.subscribe(
      (state) => ({
        blacklist: state.blacklist,
        ruleset: state.ruleset,
        subscriptions: state.subscriptions,
      }),
      (slice) => {
        closeDialog();
        this.#ruleset = createInteractiveRuleset(
          slice.blacklist,
          slice.ruleset || null,
          slice.subscriptions,
        );
        for (const result of this.#results.values()) {
          this.#judgeResult(result);
        }
        this.#notifyBlockedResultCount();
      },
      { equalityFn: shallow },
    );
  }

  start() {
    this.#scanResults();
    this.#resume();
  }

  #resume() {
    this.#observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  #pause() {
    this.#observer.disconnect();
  }

  #onMutation(records: MutationRecord[]) {
    this.#pause();
    try {
      for (const record of records) {
        if (!(record.target instanceof Element)) {
          continue;
        }
        const root = record.target.closest(`[${C.RESULT_ATTRIBUTE}]`);
        if (root) {
          const oldResult = this.#results.get(root);
          if (!oldResult) {
            continue;
          }
          const newResult = getResult(
            root,
            oldResult.description,
            oldResult.serpDescription,
          );
          if (!newResult) {
            this.#removeResult(oldResult);
            continue;
          }
          if (
            newResult.url === oldResult.url &&
            isEqual(newResult.props, oldResult.props)
          ) {
            continue;
          }
          newResult.removeButton = oldResult.removeButton;
          this.#results.set(root, newResult);
          if (process.env.DEBUG) {
            console.debug("Updated result:", newResult);
          }
          this.#judgeResult(newResult);
        }
      }
      this.#scanResults();
    } finally {
      this.#resume();
    }
  }

  #scanResults() {
    for (const [root, result] of this.#results.entries()) {
      if (!root.isConnected) {
        this.#removeResult(result);
      }
    }
    for (const serpDesc of this.#serpDescriptions) {
      for (const desc of serpDesc.results) {
        if (!desc) {
          continue;
        }
        for (const root of getRoots(desc)) {
          if (
            root.closest(`[${C.RESULT_ATTRIBUTE}]`) ||
            root.querySelector(`[${C.RESULT_ATTRIBUTE}]`)
          ) {
            continue;
          }
          const result = getResult(root, desc, serpDesc);
          if (!result) {
            continue;
          }
          root.setAttribute(C.RESULT_ATTRIBUTE, "1");
          result.removeButton = addButton(
            root,
            svgToDataURL(icon),
            24,
            () => {
              const currentResult = this.#results.get(root);
              if (!currentResult) {
                return;
              }
              openDialog(currentResult, this.#ruleset);
            },
            desc,
          );
          this.#results.set(root, result);
          if (process.env.DEBUG) {
            console.debug("New result:", result);
          }
          this.#judgeResult(result);
        }
      }
    }
    this.#notifyBlockedResultCount();
  }

  #judgeResult(result: Result) {
    if (result.root.hasAttribute(C.BLOCK_ATTRIBUTE)) {
      result.root.removeAttribute(C.BLOCK_ATTRIBUTE);
      --this.#blockedResultCount;
    }
    result.root.removeAttribute(C.HIGHLIGHT_ATTRIBUTE);
    const queryResult = this.#ruleset.query({
      url: result.url,
      ...result.props,
    });
    if (queryResult?.type === "block") {
      result.root.setAttribute(C.BLOCK_ATTRIBUTE, "1");
      ++this.#blockedResultCount;
      return;
    }
    if (queryResult?.type === "highlight") {
      result.root.setAttribute(
        C.HIGHLIGHT_ATTRIBUTE,
        String(queryResult.colorNumber),
      );
      return;
    }
  }

  #removeResult(result: Result) {
    result.removeButton?.();
    result.root.removeAttribute(C.RESULT_ATTRIBUTE);
    if (result.root.hasAttribute(C.BLOCK_ATTRIBUTE)) {
      result.root.removeAttribute(C.BLOCK_ATTRIBUTE);
      --this.#blockedResultCount;
    }
    result.root.removeAttribute(C.HIGHLIGHT_ATTRIBUTE);
    this.#results.delete(result.root);
  }

  #notifyBlockedResultCount() {
    postMessage("notify-blocked-result-count", this.#blockedResultCount);
  }

  #serpDescriptions: readonly SerpDescription[];
  #ruleset: InteractiveRuleset;
  #observer: MutationObserver;
  #results: Map<Element, Result>;
  #blockedResultCount: number;
}

export function filter(serps: readonly SerpDescription[]) {
  new Filter(serps).start();
}
