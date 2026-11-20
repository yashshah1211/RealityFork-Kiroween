import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/audit-proposals.json", import.meta.url), "utf8"));
const question = "What if my exams were two hours long?";
const code = "RF-" + "a".repeat(32); // A mock-only code used by the intercepted endpoints.
const required = { ok: false, code: "judge-required", message: "Enter a judge access code to use the AI guide." };

test("judge code unlocks the pending draft and a later revisit after session expiry", async ({ page }) => {
  let verified = false;
  await page.route("**/api/judge/session", async (route) => {
    if (route.request().postDataJSON().code === code) verified = true;
    await route.fulfill({ status: verified ? 200 : 401, json: { ok: verified } });
  });
  await page.route("**/api/plan", async (route) => {
    expect(route.request().postDataJSON().question).toBe(question);
    await route.fulfill({
      status: verified ? 200 : 401,
      json: verified ? { ok: true, proposal: fixture["exam-length"], model: "mock", warnings: [] } : required,
    });
  });
  const suggestion = {
    summary: "Because the exam is split into shorter sessions, fatigue could build up less.",
    reconsider: [], add: [], questions: [], evidence: [],
  };
  await page.route("**/api/revisit", (route) => route.fulfill({
    status: verified ? 200 : 401,
    json: verified ? { ok: true, suggestion, model: "mock", warnings: [] } : required,
  }));
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
  const access = page.getByTestId("judge-access");
  await access.getByLabel("Judge access code").fill("invalid");
  await access.getByRole("button", { name: "Unlock AI" }).click();
  await expect(access.getByRole("status")).toContainText("invalid or expired");
  await expect(access.getByLabel("Judge access code")).toHaveValue("");
  await access.getByLabel("Judge access code").fill(code);
  await access.getByRole("button", { name: "Unlock AI" }).click();
  await page.getByTestId("explore-future-0").click();
  await expect(page.getByTestId("story-title")).toHaveText("Two-hour exams");

  await page.getByTestId("story").locator("li", { hasText: "Less fatigue towards the end of the exam" })
    .getByRole("button", { name: /^What if this changed\?/ }).click();
  await page.getByTestId("whatif-text").fill("I split the exam into shorter sessions with breaks.");
  await page.getByTestId("whatif-text-create").click();
  verified = false;
  await page.getByTestId("ask-fresh-look").click();
  await access.getByLabel("Judge access code").fill(code);
  await access.getByRole("button", { name: "Unlock AI" }).click();
  await expect(page.getByTestId("revisit-summary")).toHaveText(suggestion.summary);
});

test("a visitor can keep the typed question and start a manual map", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 401, json: required }));
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(question);
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("judge-access")).toBeVisible();
  await page.getByTestId("map-it-myself").click();
  await expect(page.getByTestId("question")).toHaveText(question);
  await expect(page.getByTestId("define-panel")).toBeVisible();
});
