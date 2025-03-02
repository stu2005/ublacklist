import { type Mutate, type StoreApi, createStore, useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { type Browser, browser } from "../browser.ts";
import { defaultLocalStorageItems } from "../local-storage.ts";

type AreaName = "sync" | "local" | "managed" | "session";

type StorageStoreApi<T extends Record<string, unknown>> = Mutate<
  StoreApi<T>,
  [["zustand/subscribeWithSelector", never]]
> & {
  attachPromise: Promise<void>;
  detach: () => void;
  use: { [K in keyof T]: () => T[K] };
};

function createStorageStore<T extends Record<string, unknown>>(
  areaName: AreaName,
  defaultState: T,
): StorageStoreApi<T> {
  const store = createStore(
    subscribeWithSelector(() => defaultState),
  ) as StorageStoreApi<T>;

  const area = browser.storage[areaName];
  const setState = store.setState;
  let pendingState: Partial<T> | null = {};

  store.setState = (partial) => {
    const state =
      typeof partial === "function" ? partial(store.getState()) : partial;
    if (pendingState) {
      pendingState = { ...pendingState, ...state };
    } else {
      area.set(state);
    }
  };

  store.attachPromise = area.get(defaultState).then((state) => {
    // biome-ignore lint/style/noNonNullAssertion: `pendingState` is never `null` here
    setState({ ...(state as T), ...pendingState! });
    pendingState = null;
  });

  const listener = (
    changes: Browser.Storage.StorageAreaOnChangedChangesType,
  ) => {
    const state: Partial<T> = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!Object.hasOwn(defaultState, key) || newValue === undefined) {
        // Ignore key additions and deletions
        continue;
      }
      state[key as keyof T] = newValue as T[keyof T];
    }
    if (pendingState) {
      pendingState = { ...pendingState, ...state };
    } else {
      setState(state);
    }
  };
  area.onChanged.addListener(listener);
  store.detach = () => {
    area.onChanged.removeListener(listener);
  };

  store.use = {} as { [K in keyof T]: () => T[K] };
  for (const key of Object.keys(defaultState)) {
    store.use[key as keyof T] = () =>
      useStore(store, (state) => state[key] as T[keyof T]);
  }

  return store;
}

export const storageStore = createStorageStore(
  "local",
  defaultLocalStorageItems,
);
