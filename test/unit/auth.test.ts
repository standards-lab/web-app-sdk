// From spike-html-apps-sdk (df65376): test/unit/auth.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { anonymous } from "@standards-lab/web-app-sdk/auth.js";

describe("anonymous", () => {
  test("gives no token", async () => {
    assert.equal(await anonymous.token(), undefined);
  });

  test("never refreshes: a refresh gives no token either", async () => {
    assert.equal(await anonymous.refresh(), undefined);
    assert.equal(await anonymous.token(), undefined);
  });

  test("is frozen, since every client that takes the default shares it", () => {
    assert.ok(Object.isFrozen(anonymous));
  });
});
