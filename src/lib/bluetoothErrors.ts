/**
 * What went wrong connecting a smart cube, in words that say what to do.
 * The browser's own messages name its internals ("GATT Server is disconnected")
 * and leave the person guessing. Null means it was not an error at all.
 */
export function friendlyBluetoothError(message: string): string | null {
  if (/cancel/i.test(message)) return null;
  if (/adapter not available|bluetooth is (off|disabled|unavailable)/i.test(message)) {
    return "Bluetooth looks switched off on this computer. Turn Bluetooth on, then connect again.";
  }
  if (/mac address/i.test(message)) {
    return "The cube's Bluetooth address is needed to connect it, and none was given. Connect again and enter the address when asked.";
  }
  if (/gatt|disconnected|network error/i.test(message)) {
    return "The cube stopped answering — it may have gone to sleep. Turn a face to wake it, then connect again.";
  }
  return message;
}
