import { describe, expect, test } from "bun:test";

import { dashboardPage, loginPage } from "./page";

describe("pages", () => {
  test("login errors are escaped", () => {
    const html = loginPage(`<img src=x onerror="alert(1)">`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img");
  });

  test("dashboard loads only same-origin scripts", () => {
    const scripts = [...dashboardPage().matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(["/assets/uplot.js", "/assets/app.js"]);
    expect(dashboardPage()).not.toMatch(/<script>(?!<\/script>)/);
  });
});
