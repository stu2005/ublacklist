import { type Root, createRoot } from "react-dom/client";
import { BlockDialog } from "../block-dialog.tsx";
import type { InteractiveRuleset } from "../interactive-ruleset.ts";
import { saveToLocalStorage } from "../local-storage.ts";
import { sendMessage } from "../messages.ts";
import type { DialogTheme } from "../types.ts";
import { storageStore } from "./storage-store.ts";
import type { Result } from "./types.ts";

type DialogRoot = { root: Root; shadowRoot: ShadowRoot };

let dialogRoot: DialogRoot | null = null;

function getDialogRoot(): DialogRoot {
  if (!dialogRoot) {
    const shadowRoot = document.body
      .appendChild(document.createElement("div"))
      .attachShadow({ mode: "open" });
    const root = createRoot(shadowRoot);
    dialogRoot = { root, shadowRoot };
  }
  return dialogRoot;
}

function getBackgroundColor(
  element: Element,
): [number, number, number, number] {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?/.exec(
    window.getComputedStyle(element).backgroundColor,
  );
  if (!m) {
    return [0, 0, 0, 0]; // transparent fallback
  }
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 1];
}

function getDialogTheme(): DialogTheme {
  let [r, g, b, a] = getBackgroundColor(document.body);
  if (a === 0) {
    [r, g, b, a] = getBackgroundColor(document.documentElement);
    if (a === 0) {
      return "light";
    }
  }
  // https://www.w3.org/WAI/ER/WD-AERT/#color-contrast
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 125 ? "dark" : "light";
}

export function closeDialog() {
  if (!dialogRoot) {
    return;
  }
  dialogRoot.root.render(null);
}

export function openDialog(result: Result, ruleset: InteractiveRuleset) {
  const state = storageStore.getState();
  const props = { ...result.props, url: result.url };
  const onBlocked = () =>
    void saveToLocalStorage(
      { blacklist: ruleset.toString() },
      "content-script",
    );
  if (state.skipBlockDialog) {
    ruleset.createPatch(props, state.blockWholeSite);
    ruleset.applyPatch();
    onBlocked();
    return;
  }
  const dialogRoot = getDialogRoot();
  dialogRoot.root.render(
    <BlockDialog
      blockWholeSite={state.blockWholeSite}
      close={closeDialog}
      enablePathDepth={state.enablePathDepth}
      enableMatchingRules={state.enableMatchingRules}
      entryProps={props}
      open={true}
      openOptionsPage={() => sendMessage("open-options-page")}
      ruleset={ruleset}
      target={dialogRoot.shadowRoot}
      theme={
        state.dialogTheme !== "default" ? state.dialogTheme : getDialogTheme()
      }
      onBlocked={onBlocked}
    />,
  );
}
