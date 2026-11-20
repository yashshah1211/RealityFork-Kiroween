/**
 * 3D Explore preview (?preview=atlas), the main journey: the real app and the real RealityStore, drawn in 3D on the
 * machine GPU, recorded as a continuous video. No AI and no network: every /api request is refused and recorded, and
 * every request must stay on this server. Screenshots: docs/validation/screenshots/atlas-3d/. Video:
 * test-results/atlas-walkthrough.webm (converted to docs/validation/atlas-3d/walkthrough.mp4).
 */
import { expect, test } from "@playwright/test";
import { details, GPU, guard, openExample, settle, shot, stats } from "./atlas-helpers";


test.use({ launchOptions: { args: GPU }, viewport: { width: 1440, height: 900 }, video: { mode: "on", size: { width: 1440, height: 900 } } });

test("Mumbai to London and solar: select, branch and compare through the real store", async ({ page }, info) => {
  const g = await guard(page);
  // 1. The real Explore view with the Mumbai-to-London example, in 3D.
  await openExample(page, "move-city");
  await settle(page, { model: true });
  expect((await stats(page))!.gpu).not.toContain("SwiftShader");
  await expect(page.getByTestId("atlas-question")).toHaveText("What if I moved from Mumbai to London?");
  await expect(page.getByTestId("atlas-title")).toHaveText("Stay in Mumbai");
  await expect(page.getByTestId("atlas-world")).toHaveText("Illustrative scenery (city at night): nothing in the picture is a fact about this future.");
  expect((await stats(page))!.universe).toBe("urban");
  // Calculated results come from core, with where each figure came from (in the card's Details).
  await details(page);
  await expect(page.getByTestId("atlas-calc-monthlySavings")).toContainText("£650 per month");
  await expect(page.getByTestId("atlas-calc-monthlySavings")).toContainText("example figure");
  await expect(page.getByTestId("atlas-node-Move to London")).toBeVisible();
  await shot(page, "01-explore-mumbai-london");

  // 2. The whole map.
  await page.getByTestId("atlas-overview").click();
  await settle(page);
  for (const name of ["Stay in Mumbai", "Move to London", "London, remote job"]) await expect(page.getByTestId(`atlas-node-${name}`)).toBeVisible();
  await shot(page, "02-overview");

  // 3. Choosing a future in the overview brings it into focus: the detailed London model.
  await page.getByTestId("atlas-node-Move to London").click();
  await expect(page.getByTestId("atlas-title")).toHaveText("Move to London");
  await expect(page.getByTestId("atlas-focus")).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  let s = (await stats(page))!;
  expect(s.model.state).toBe("ready");
  expect(s.islands.filter((x) => x.visual === "london-full")).toHaveLength(1);
  await expect(page.getByTestId("atlas-world")).toHaveText("Shown as London: City is London on this path.");
  await expect(page.getByTestId("atlas-changes")).toContainText("City: London");
  await expect(page.getByTestId("atlas-calc-monthlySavings")).toContainText("£700 per month");
  await expect(page.getByTestId("atlas-crumb-Stay in Mumbai")).toBeVisible();
  await shot(page, "03-move-to-london");

  // 4. Into a future that continues from it (captured mid-flight).
  await page.getByTestId("atlas-node-London, remote job").click();
  await page.waitForTimeout(380);
  await shot(page, "04-transition-to-child");
  await settle(page);
  await expect(page.getByTestId("atlas-title")).toHaveText("London, remote job");
  await expect(page.getByTestId("atlas-changes")).toContainText("Work from home: yes");

  // 5–6. A new path from here, described in the user's own words: the standard view's sheet and operation.
  await page.getByTestId("atlas-branch").click();
  await expect(page.getByTestId("fork-sheet")).toBeVisible();
  const described = "Share a flat in Zone 2 with a friend";
  await page.getByTestId("fork-describe").fill(described);
  await shot(page, "05-creating-branch");
  await page.getByTestId("fork-describe-create").click();
  await expect(page.getByTestId("atlas-title")).toHaveText(described);
  await expect(page.getByTestId("whatif-note")).toContainText(`Exploring: ${described}`);
  // A described change is a what-if RealityFork does not interpret: no detailed place is drawn for it.
  await expect(page.getByTestId("atlas-world")).toContainText("does not interpret");
  await expect(page.getByTestId("atlas-crumb-London, remote job")).toBeVisible();
  await settle(page);
  s = (await stats(page))!;
  expect(s.islands).toHaveLength(4);
  await shot(page, "06-new-branch-created");
  // It is a real path in the real map: saved, and in the standard view.
  const saved = await page.evaluate(() => localStorage.getItem("realityfork.realities.v1") ?? "");
  expect(saved).toContain(described);
  await page.getByTestId("atlas-classic").click();
  await expect(page.getByTestId("story")).toBeVisible();
  await expect(page.getByTestId(`branch-${described}`)).toBeVisible();
  await expect(page.getByTestId("story-title")).toHaveText(described);
  await page.getByTestId("atlas-open").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await settle(page, { model: true });

  // Compare from the 3D view: the standard Compare stage, then back.
  await page.getByTestId("atlas-crumb-Move to London").click();
  await settle(page);
  await page.getByTestId("atlas-compare").click();
  await expect(page.getByTestId("compare-sheet")).toBeVisible();
  await page.getByTestId("compare-pick-Stay in Mumbai").click();
  await expect(page.getByTestId("compare-view")).toBeVisible();
  await expect(page.getByTestId("compare-view")).toContainText("Move to London");
  await page.waitForTimeout(500);
  await shot(page, "09-compare-from-explore");
  await page.getByTestId("continue-a").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await settle(page, { model: true });
  expect((await stats(page))!.islands.filter((x) => x.visual === "london-full")).toHaveLength(1);

  // 7–8. Solar: a different kind of decision, no place, no London asset needed.
  await page.getByTestId("home").click();
  await page.getByTestId("example-solar").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await settle(page);
  await expect(page.getByTestId("atlas-question")).toHaveText("What if our household installed solar panels?");
  await expect(page.getByTestId("atlas-title")).toHaveText("4 kW system, today's prices");
  await details(page);
  await expect(page.getByTestId("atlas-calc-paybackYears")).toContainText("8.3 years");
  s = (await stats(page))!;
  // Every solar island is drawn by the energy kit; panels on every path, a battery only where the path says yes.
  expect(s.universe).toBe("energy");
  expect(s.islands.every((x) => x.visual === "kit" && x.family === "energy" && x.props.includes("solar"))).toBe(true);
  expect(s.islands.filter((x) => x.props.includes("battery"))).toHaveLength(1);
  await shot(page, "07-solar-explore");
  await page.getByTestId("atlas-node-Add a battery").click();
  await settle(page);
  await expect(page.getByTestId("atlas-title")).toHaveText("Add a battery");
  await expect(page.getByTestId("atlas-calc-paybackYears")).toContainText("10.6 years");
  await expect(page.getByTestId("atlas-possible")).toContainText("Backup power during outages");
  await expect(page.getByTestId("atlas-possible")).toContainText("not predictions");
  await shot(page, "08-solar-future-selected");

  expect(g.api).toEqual([]);
  expect(g.foreign).toEqual([]);
  expect(g.errors).toEqual([]);
  const video = page.video();
  await page.close();
  // The raw recording (about 20 MB) stays in test-results/; docs/validation/atlas-3d/walkthrough.mp4 is made from it with ffmpeg.
  await video?.saveAs("test-results/atlas-walkthrough.webm");
  info.annotations.push({ type: "requests", description: String(g.all.length) });
});
