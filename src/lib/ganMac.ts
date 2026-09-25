/**
 * The MAC address a modern GAN cube needs before it will talk.
 *
 * GAN (and MoYu AI, Monster Go) cubes encrypt what they send, with a key salted
 * by the cube's own Bluetooth address. Chrome only reveals that address behind
 * an experimental setting, so when it cannot be read, the person is asked for
 * it once — the way csTimer does — and it is remembered for that cube.
 */

export const MAC_STORE_KEY = "cubeduel.ganMac.v1";

/** "AB:12:CD:34:EF:56" from however it was typed or pasted, or null if it is not one. */
export function normalizeMac(input: string): string | null {
  const hex = input.trim().replace(/[:\-\s]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/g)!.join(":");
}

/** Remembered addresses by cube name; anything unreadable is dropped. */
export function readRememberedMacs(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [name, mac] of Object.entries(value ?? {})) {
      const clean = typeof mac === "string" ? normalizeMac(mac) : null;
      if (clean) out[name] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** The store with this cube's address added, as a string to save. */
export function rememberMac(raw: string | null, deviceName: string, mac: string): string {
  return JSON.stringify({ ...readRememberedMacs(raw), [deviceName]: mac });
}
