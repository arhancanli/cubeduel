import assert from "node:assert/strict";
import { test } from "node:test";

import { friendlyBluetoothError } from "./bluetoothErrors";

test("closing the device list is not an error", () => {
  assert.equal(friendlyBluetoothError("User cancelled the requestDevice() chooser."), null);
  assert.equal(friendlyBluetoothError("NotFoundError: User cancelled"), null);
});

test("Bluetooth switched off says to switch it on", () => {
  assert.match(friendlyBluetoothError("Bluetooth adapter not available.")!, /turn Bluetooth on/i);
});

test("a GAN cube whose address was never given says what to do", () => {
  assert.match(friendlyBluetoothError("Unable to determine cube MAC address, connection is not possible!")!, /address/i);
});

test("a cube that went to sleep says to wake it", () => {
  assert.match(friendlyBluetoothError("GATT Server is disconnected. Cannot retrieve services.")!, /turn a face/i);
});

test("anything unrecognised is passed through rather than hidden", () => {
  assert.equal(friendlyBluetoothError("Something odd happened"), "Something odd happened");
});
