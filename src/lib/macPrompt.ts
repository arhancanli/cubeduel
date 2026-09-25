"use client";

import { useSyncExternalStore } from "react";

import { MAC_STORE_KEY, normalizeMac, readRememberedMacs, rememberMac } from "./ganMac";

/**
 * The one question a GAN cube can need answered by hand: its address. Asked by
 * the connection code, answered by <MacPrompt> wherever the page is — so any
 * page that connects a cube gets the same dialog.
 */

interface Pending {
  deviceName: string;
  resolve: (mac: string | null) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePendingMac(): Pending | null {
  return useSyncExternalStore(subscribe, () => pending, () => null);
}

/** Asks for this cube's address; resolves to it, or null if the person gave up. */
export function askForMac(deviceName: string): Promise<string | null> {
  return new Promise((resolve) => {
    pending?.resolve(null);
    pending = {
      deviceName,
      resolve: (mac) => {
        pending = null;
        emit();
        if (mac) {
          try {
            localStorage.setItem(MAC_STORE_KEY, rememberMac(localStorage.getItem(MAC_STORE_KEY), deviceName, mac));
          } catch {
            /* remembered or not, the connection goes ahead */
          }
        }
        resolve(mac);
      },
    };
    emit();
  });
}

/** An address this cube has given before, if any. */
export function rememberedMac(deviceName: string): string | null {
  try {
    return readRememberedMacs(localStorage.getItem(MAC_STORE_KEY))[deviceName] ?? null;
  } catch {
    return null;
  }
}

export { normalizeMac };
