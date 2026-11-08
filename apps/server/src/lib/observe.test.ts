import { describe, expect, test } from "bun:test";

import { newRef, routeOf } from "./observe";

describe("observability", () => {
  test("references are short and unambiguous", () => {
    const ref = newRef();
    expect(ref).toMatch(/^GM-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(new Set(Array.from({ length: 1000 }, newRef)).size).toBe(1000);
  });

  test("routes group by shape, not by id", () => {
    expect(routeOf("/v1/accounts/1f0c2b9e-5d7a-4b3c-9e8f-0a1b2c3d4e5f/threads/18c2f0a9b3d4e5f6")).toBe(
      "/v1/accounts/:id/threads/:id",
    );
    expect(routeOf("/v1/accounts/1f0c2b9e-5d7a-4b3c-9e8f-0a1b2c3d4e5f/folders/INBOX/mark-read")).toBe(
      "/v1/accounts/:id/folders/INBOX/mark-read",
    );
    expect(routeOf("/v1/me/settings")).toBe("/v1/me/settings");
  });
});
