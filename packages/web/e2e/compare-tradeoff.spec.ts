/**
 * Product sprint: Compare as a decision view, in a real browser. The drafts are the three RECORDED LIVE model replies of
 * the sprint (sprint-live-drafts.json), replayed by a mocked /api/plan: no live model is contacted, and every other /api
 * request is refused. Screenshots go to Playwright's own output folder (git-ignored), never to docs/.
 *
 *  - the trade-off: what could favour each choice, from the paths' own possibilities (a difficulty on one path counts for
 *    the other choice and says where it was written; nothing is scored; a path with nothing of its own is said)
 *  - what would let the calculated outcomes be compared: the missing figures, entered right in Compare, per path
 *  - choices the AI wrote as code identifiers ("fullTime", "newCountry") are shown in words
 * Three unrelated decisions: a café (business), self-study (education), moving abroad (personal).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Recorded { question: string; model: string; warnings: string[]; proposal: { branches: { name: string }[] } }
const live = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/sprint-live-drafts.json", import.meta.url)), "utf8")) as Record<string, Recorded>;
const cafe = live.cafe!;
const study = live.selfStudy!;
const abroad = live.abroad!;
const names = (r: Recorded) => r.proposal.branches.map((b) => b.name);

interface Seen { plan: number; other: string[]; errors: string[] }
async function replay(page: Page, r: Recorded): Promise<Seen> {
  const seen: Seen = { plan: 0, other: [], errors: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (!url.endsWith("/api/plan")) {
      seen.other.push(url);
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, code: "blocked-in-test", message: "Not in this test." }) });
    }
    seen.plan++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, proposal: r.proposal, model: `${r.model} (recorded live reply, replayed)`, warnings: r.warnings }) });
  });
  await page.goto("/");
  await page.getByTestId("whatif-input").fill(r.question);
  await page.getByTestId("explore-possibilities").click();
  await expect(page.getByTestId("future-card-0")).toBeVisible();
  return seen;
}
async function compare(page: Page, first: string, second: string) {
  await page.getByTestId(`explore-future-${0}`).waitFor();
  const cards = await page.locator("[data-testid^=future-name-]").allInnerTexts();
  await page.getByTestId(`explore-future-${cards.indexOf(first)}`).click();
  await expect(page.getByTestId("story-title")).toHaveText(first);
  await page.getByTestId("compare-with").click();
  await page.getByTestId(`compare-pick-${second}`).click();
  await expect(page.getByTestId("compare-view")).toBeVisible();
}
const overflowing = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "mobile-390", width: 390, height: 844 }]) {
  test.describe(`Compare as a decision view (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("café: each choice shows what could favour it, and the four missing figures are entered right in Compare until both outcomes are set side by side", async ({ page }, info) => {
      const [open, stay] = names(cafe) as [string, string];
      const seen = await replay(page, cafe);
      // Plain words on the futures, not the AI's identifiers.
      await expect(page.getByTestId("future-card-0")).toContainText("Café operating mode: full time");
      await expect(page.getByTestId("discover")).not.toContainText("fullTime");
      await compare(page, open, stay);
      await expect(page.getByTestId("cmp-differ")).toContainText("full time");
      await expect(page.getByTestId("compare-view")).not.toContainText("fullTime");

      // The trade-off, from the paths' own words.
      const forA = page.getByTestId("trade-for-a");
      const forB = page.getByTestId("trade-for-b");
      await expect(forA).toContainText(`What could favour “${open}”`);
      await expect(forA).toContainText(`Could go well on “${open}”`);
      await expect(forA).toContainText("You could earn more than your current salary if the café becomes popular.");
      await expect(forA).toContainText(`Could be hard on “${stay}”`);
      await expect(forA).toContainText("You may miss out on a potentially rewarding entrepreneurial experience.");
      await expect(forB).toContainText("Your income remains stable and you avoid the risks of starting a business.");
      await expect(forB).toContainText(`Could be hard on “${open}”`);
      await expect(forB).toContainText("Initial costs and the need for a food‑service license may strain cash flow.");
      await expect(page.getByTestId("cmp-either")).toContainText("Listed in both");
      await expect(page.getByTestId("cmp-either")).toContainText("The success of the café will depend heavily on location and local demand.");
      // Nothing is scored or declared better.
      await expect(page.getByTestId("cmp-tradeoff")).toContainText("Nothing is scored.");
      await expect(page.getByTestId("cmp-tradeoff")).not.toContainText(/\b(winner|better choice|recommended|score:)/i);
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `${vp.name}-cafe-tradeoff`);

      // What would let the outcomes be compared: entered here, per path, and saved as the user's own estimate.
      await expect(page.getByTestId("cmp-not-comparable")).toContainText("add your numbers for: Café monthly revenue, Café monthly operating costs");
      const enter = async (side: "a" | "b", key: string, value: string) => {
        await page.getByTestId(`settle-${side}-${key}-input`).fill(value);
        await page.getByTestId(`settle-${side}-${key}-save`).click();
        await expect(page.getByTestId(`settle-${side}-${key}-input`)).toHaveCount(0);
      };
      // A typed amount follows the one parsing policy: an ambiguous one is refused with the reason, nothing is saved.
      await page.getByTestId("settle-a-cafeRevenue-input").fill("1,5");
      await page.getByTestId("settle-a-cafeRevenue-save").click();
      await expect(page.getByTestId("settle-cafeRevenue")).toContainText(/1,5/);
      await expect(page.getByTestId("settle-a-cafeRevenue-input")).toHaveAttribute("aria-invalid", "true");
      await enter("a", "cafeRevenue", "18000");
      await enter("a", "cafeCosts", "11000");
      // Only one side has them: still not compared, and only the other side is asked.
      await expect(page.getByTestId("cmp-worked")).not.toContainText("7,000");
      await expect(page.getByTestId("settle-cafeRevenue")).toContainText(`in “${stay}”`);
      await enter("b", "cafeRevenue", "0");
      await enter("b", "cafeCosts", "0");
      await expect(page.getByTestId("settle-cafeRevenue")).toHaveCount(0);
      await expect(page.getByTestId("cmp-worked")).toContainText("Net café profit per month");
      await expect(page.getByTestId("cmp-worked")).toContainText("7,000");
      // QA fix: zeros typed for the café on the path that keeps the job are not a result about that path, so no gain is
      // claimed (no "B − A"); the reason is said, with a way to mark them as not applying.
      const profitRow = page.getByTestId("cmp-worked").locator("li", { hasText: "Net café profit per month" });
      await expect(profitRow).toContainText(`Every figure behind this is 0 on “${stay}”`);
      await expect(profitRow).not.toContainText("B − A");
      await expect(profitRow).toContainText("Worked out from: Café monthly revenue, Café monthly operating costs.");
      // The other outcome still names exactly what it needs.
      await expect(page.getByTestId("settle-hoursPerWeekJob")).toBeVisible();
      await expect(page.getByTestId("compare-view")).toBeVisible();
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `${vp.name}-cafe-settled`);

      // The figures are the user's own, on the path they were entered for, and nowhere else.
      await page.getByTestId("continue-a").click();
      await expect(page.getByTestId("story-title")).toHaveText(open);
      await expect(page.getByTestId("story-known")).toContainText("Café monthly revenue: 18,000");
      await expect(page.getByTestId("story-known")).toContainText("Café monthly operating costs: 11,000");
      expect(seen.plan).toBe(1);
      expect(seen.other).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test("self-study: the path the user asked about has no possibilities of its own, which is said; what favours it comes from the university's difficulties", async ({ page }, info) => {
      const [self, uni] = names(study) as [string, string];
      const seen = await replay(page, study);
      await expect(page.getByTestId("future-card-0")).toContainText("Learning approach: self study");
      await compare(page, self, uni);
      await expect(page.getByTestId("cmp-differ")).toContainText("self study");
      await expect(page.getByTestId("trade-for-a")).toContainText(`Could be hard on “${uni}”`);
      await expect(page.getByTestId("trade-for-a")).toContainText("High tuition and fixed schedules may limit flexibility and increase financial pressure.");
      await expect(page.getByTestId("trade-none-own-a")).toContainText(`No possibilities were noted for “${self}” on its own, so what is here comes from the other path.`);
      await expect(page.getByTestId("trade-for-b")).toContainText("A recognized degree can open doors in fields that require accredited qualifications.");
      await expect(page.getByTestId("trade-none-own-b")).toHaveCount(0);
      // No formulas in this draft: nothing to settle is invented.
      await expect(page.getByTestId("cmp-settle")).toHaveCount(0);
      expect(await overflowing(page)).toBe(false);
      await shot(page, info, `${vp.name}-self-study-tradeoff`);
      expect(seen.plan).toBe(1);
      expect(seen.errors).toEqual([]);
    });
  });
}

test.describe("Compare as a decision view: a personal decision", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("moving abroad: a future with nothing noted is said, the staying future's difficulty speaks for it, and the AI's identifiers read as words in Compare and on the question card", async ({ page }, info) => {
    const [stay, , remote] = names(abroad) as [string, string, string];
    const seen = await replay(page, abroad);
    await expect(page.getByTestId("discover")).toContainText("Country you might move to: new country");
    await expect(page.getByTestId("discover")).not.toContainText("newCountry");
    await compare(page, stay, remote);
    await expect(page.getByTestId("cmp-differ")).toContainText("new country");
    await expect(page.getByTestId("trade-for-b")).toContainText(`Could be hard on “${stay}”`);
    await expect(page.getByTestId("trade-for-b")).toContainText("Local job market may limit the speed or level of career advancement you hope for.");
    await expect(page.getByTestId("trade-none-own-b")).toContainText(`No possibilities were noted for “${remote}” on its own`);
    await expect(page.getByTestId("trade-for-a")).toContainText("You keep your existing network and avoid the hassle of immigration.");
    await shot(page, info, "desktop-1440-abroad-tradeoff");
    // Back on a path, the question card offers the choices in words; the stored value stays the AI's own.
    await page.getByTestId("continue-a").click();
    await expect(page.getByTestId("question-card")).toContainText("Country you might move to");
    await expect(page.getByTestId("answer-currentCountry")).toHaveText("current country");
    await page.getByTestId("answer-currentCountry").click();
    await expect(page.getByTestId("story-known")).toContainText("Country you might move to: current country");
    expect(seen.plan).toBe(1);
    expect(seen.other).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});
