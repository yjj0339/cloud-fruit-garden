import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
});

test("native responsive map opens without device simulator chrome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("main", { name: "云海果乐园关卡地图" })).toBeVisible();
  await expect(page.locator(".phone-stage, .device-menu-bar, .phone-bezel")).toHaveCount(0);
  const box = await page.locator(".level-map-screen").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "audit/01-map-390x844.png", fullPage: true });
});

test("level entry, drag feedback, and booster selection are interactive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".map-level").first().click();
  await expect(page.getByRole("main", { name: "云海果乐园三消游戏" })).toBeVisible();
  await expect(page.locator(".tile")).toHaveCount(64);

  const board = page.locator(".game-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Game board has no bounding box");
  const cell = box.width / 8;
  const startX = box.x + cell / 2;
  const startY = box.y + cell / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + cell * 0.6, startY, { steps: 3 });
  const transform = await page.locator(".tile.is-dragging").evaluate((element) => getComputedStyle(element).transform);
  expect(transform).not.toBe("none");
  await page.mouse.up();
  await expect(page.locator('.garden-game[data-phase="idle"]')).toBeVisible();

  await page.getByRole("button", { name: /小锤敲击/ }).click();
  await expect(page.getByText(/小锤已选中/)).toBeVisible();
  await page.locator(".tile").first().click({ force: true });
  await expect(page.getByRole("button", { name: /小锤敲击，剩余 2 个/ })).toBeVisible();
  await page.screenshot({ path: "audit/02-game-390x844.png", fullPage: true });
});

test("locked levels remain inaccessible", async ({ page }) => {
  const locked = page.locator(".map-level").nth(1);
  await expect(locked).toBeDisabled();
  await expect(page.getByText("当前已解锁 1/20 关")).toBeVisible();
});
