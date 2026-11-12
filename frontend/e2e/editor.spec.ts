import { expect, test } from "@playwright/test";
import { SEQ, fetchRecord, openNewRecord, placeCursor, selectionText } from "./helpers";

test("the library lists the sample plasmids and opens one from the keyboard", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("button", { name: "Open pUC19", exact: true });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".crumb-name")).toHaveText("pUC19");
  await expect(page.locator(".crumb-meta")).toContainText("2,686 bp · circular");
});

test("map and sequence are both on screen without scrolling", async ({ page, request }) => {
  await openNewRecord(page, request, "layout");
  const viewport = page.viewportSize()!;
  for (const selector of [".map-pane svg.map-svg", ".linear-pane svg.map-svg", ".seq-viewer"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.y + Math.min(box.height, 100), selector).toBeLessThanOrEqual(viewport.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
});

test("positions are shown 1-based and inclusive", async ({ page, request }) => {
  await openNewRecord(page, request, "coords");
  await placeCursor(page, 4);
  await expect(selectionText(page)).toHaveText("Cursor 4 | 5");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(selectionText(page)).toHaveText("5–10 · 6 bp");
});

test("typing inserts bases through the engine, and undo takes them back", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "typing");
  await placeCursor(page, 4);
  await page.keyboard.type("acgtn");
  await expect(page.locator(".crumb-meta")).toContainText("125 bp");
  expect((await fetchRecord(request, id)).sequence).toBe(SEQ.slice(0, 4) + "ACGTN" + SEQ.slice(4));
  await expect(selectionText(page)).toHaveText("Cursor 9 | 10");

  // Undo until the engine has nothing left: back to the original sequence.
  const undo = page.getByRole("button", { name: "Undo", exact: true }).first();
  while (await undo.isEnabled()) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
  }
  expect((await fetchRecord(request, id)).sequence).toBe(SEQ);
  // The cursor is back where the change was, so typing can continue there.
  await expect(selectionText(page)).toHaveText("Cursor 4 | 5");
});

test("typing over a selection replaces it; Backspace deletes", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "replace");
  await placeCursor(page, 10);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("G");
  await expect(page.locator(".crumb-meta")).toContainText("116 bp");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".crumb-meta")).toContainText("115 bp");
  expect((await fetchRecord(request, id)).sequence).toBe(SEQ.slice(0, 10) + SEQ.slice(15));
});

test("right-click → New feature from selection fills in the range", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "feature");
  await placeCursor(page, 10);
  for (let i = 0; i < 20; i++) await page.keyboard.press("Shift+ArrowRight");
  await placeCursorRightClick(page);
  await page.getByRole("menuitem", { name: "New feature from selection…" }).click();
  await expect(page.locator("#tab-features")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.type("my promoter");
  await page.keyboard.press("Enter");
  await expect(page.locator(".feature-coords").first()).toContainText("11–30");
  expect((await fetchRecord(request, id)).features).toMatchObject([{ name: "my promoter", start: 10, end: 30 }]);

  // …and the History tab lists it.
  await page.locator("#tab-history").click();
  await expect(page.locator(".history li").first()).toContainText("Added feature");
});

async function placeCursorRightClick(page: import("@playwright/test").Page) {
  // Right-click inside the current selection (base 15 on the first line).
  const viewer = page.locator(".seq-viewer");
  const box = (await viewer.boundingBox())!;
  const g = await page.evaluate(() => {
    const probe = document.querySelector(".seq-probe")!.getBoundingClientRect();
    const first = document.querySelector(".seq-line")!.getBoundingClientRect();
    return { cw: probe.width / 10, top: first.top };
  });
  const gutter = 5 * g.cw; // "120" is three digits, plus two
  await page.mouse.click(box.x + 14 + gutter + (15 + 1) * g.cw, g.top + 8, { button: "right" });
}

test("a record can be renamed, made linear and duplicated", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "props");
  await page.locator("button.crumb-name").click();
  await page.keyboard.type("pRenamed");
  await page.keyboard.press("Enter");
  await expect(page.locator(".crumb-name")).toHaveText("pRenamed");
  await expect(page).toHaveTitle("pRenamed — OpenGene");

  await page.getByRole("button", { name: "Record actions" }).click();
  await page.getByRole("button", { name: "Make linear" }).click();
  await expect(page.locator(".crumb-meta")).toContainText("linear");
  expect(await fetchRecord(request, id)).toMatchObject({ name: "pRenamed", isCircular: false });

  await page.getByRole("button", { name: "Record actions" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.locator(".crumb-name")).toHaveText("pRenamed copy");
});

test("the open record comes back after a reload", async ({ page, request }) => {
  await openNewRecord(page, request, "reload");
  await page.reload();
  await expect(page.locator(".crumb-name")).toHaveText("reload");
  await page.getByRole("button", { name: "Library", exact: true }).first().click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});

test("several files import into the library, and a bad one is named", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "one.fasta", mimeType: "text/plain", buffer: Buffer.from(">one\nACGTACGTACGTACGT\n") },
    { name: "two.fasta", mimeType: "text/plain", buffer: Buffer.from(">two\nGGGGCCCCAAAATTTT\n") },
    { name: "broken.gb", mimeType: "text/plain", buffer: Buffer.from("this is not a sequence file") },
  ]);
  await expect(page.locator(".toast")).toContainText("Imported 2 of 3 files");
  await expect(page.locator(".toast")).toContainText("broken.gb");
  await expect(page.getByRole("button", { name: "Open one", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open two", exact: true })).toBeVisible();
});

test("the linear map zooms, and the keyboard steps through features", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open pUC19", exact: true }).click();
  const linear = page.locator(".linear-pane");
  await expect(linear.locator(".map-zoom-level")).toHaveText("100%");
  await linear.getByRole("button", { name: "Zoom in" }).click();
  await expect(linear.locator(".map-zoom-level")).toHaveText("150%");
  const widths = await linear.locator(".map-scroll").evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(widths[0]).toBeGreaterThan(widths[1]);
  await linear.getByRole("button", { name: "Show the whole map" }).click();
  await expect(linear.locator(".map-zoom-level")).toHaveText("100%");

  await page.locator(".map-pane svg.map-svg").focus();
  await page.keyboard.press("ArrowRight");
  const first = await selectionText(page).innerText();
  expect(first).toMatch(/·.*bp/);
  await page.keyboard.press("ArrowRight");
  await expect(selectionText(page)).not.toHaveText(first);
});
