import { expect, test } from "@playwright/test";
import { SEQ, fetchRecord, openNewRecord, placeCursor, selectionText } from "./helpers";

// Two 20-nt stretches of the test sequence, used as primers.
const FWD = SEQ.slice(30, 50);
const REV_SITE = SEQ.slice(80, 100);
const complement: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };
const REV = REV_SITE.split("").reverse().map((b) => complement[b]).join("");

async function savePrimer(page: import("@playwright/test").Page, name: string, sequence: string) {
  await page.getByPlaceholder("e.g. pUC19-seq-F").fill(name);
  await page.getByPlaceholder("ACGT…").fill(sequence);
  await page.getByRole("button", { name: "Save primer" }).click();
  await expect(page.locator(".tab-body .feature-label", { hasText: name })).toBeVisible();
}

test("saved primers show where they bind and follow the sequence through edits", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "primers");
  await page.locator("#tab-primers").click();
  await savePrimer(page, "fwd", FWD);
  await savePrimer(page, "rev", REV);
  await savePrimer(page, "stray", "GGGGGGGGGGCCCCCCCCCC");

  const row = (name: string) => page.locator(".tab-body .list li", { hasText: name });
  await expect(row("fwd")).toContainText("31–50 +");
  await expect(row("rev")).toContainText("81–100 −");
  await expect(row("stray")).toContainText("doesn’t bind");

  // Clicking a primer selects its site in every view.
  await row("rev").getByRole("button", { name: "rev", exact: true }).click();
  await expect(selectionText(page)).toContainText("81–100 · 20 bp");

  // Insert 6 bp upstream of both: the primers move with their sites.
  await placeCursor(page, 4);
  await page.keyboard.type("ACGTAC");
  await expect(row("fwd")).toContainText("37–56 +");
  await expect(row("rev")).toContainText("87–106 −");

  // Delete across the forward primer's site: it stays in the list, unbound.
  await placeCursor(page, 30);
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Delete");
  await expect(row("fwd")).toContainText("doesn’t bind");
  await expect(page.locator(".toast")).toContainText("fwd no longer binds");
  expect((await fetchRecord(request, id)).history.at(-1)?.description).toContain("deleted 30 bp");
});

test("primers can be imported, renamed and removed", async ({ page, request }) => {
  await openNewRecord(page, request, "primer-list");
  await page.locator("#tab-primers").click();
  await page.locator(".tab-body").getByRole("button", { name: "Import" }).click();
  await page.locator(".import-box textarea").fill(`fwd, ${FWD}\nnot a primer\nrev; ${REV}\n`);
  await page.locator(".import-box").getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Imported 2 primers");
  await expect(page.locator(".tab-body .list li")).toHaveCount(2);

  const fwd = page.locator(".tab-body .list li", { hasText: "fwd" });
  await fwd.hover();
  await fwd.getByRole("button", { name: "Edit fwd" }).click();
  await page.locator(".feature-editor input").fill("amplicon-F");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".tab-body .feature-label", { hasText: "amplicon-F" })).toBeVisible();

  const rev = page.locator(".tab-body .list li", { hasText: "rev" });
  await rev.hover();
  await rev.getByRole("button", { name: "Delete rev" }).click();
  await expect(page.locator(".tab-body .list li")).toHaveCount(1);
  // Removing a primer is undoable like any other change.
  await page.locator(".seq-viewer").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tab-body .list li")).toHaveCount(2);
});

test("the library lists each sequence's primers and opens straight to one", async ({ page, request }) => {
  const { id } = await openNewRecord(page, request, "tree");
  for (const [name, sequence] of [["tree-F", FWD], ["tree-R", REV]]) {
    const res = await request.post(`/api/records/${id}/primers`, { data: { name, sequence } });
    expect(res.ok()).toBeTruthy();
  }
  await page.getByRole("button", { name: "Library", exact: true }).first().click();

  // Closed by default; the twisty opens the sequence out to its primers.
  await expect(page.locator("tr.child")).toHaveCount(0);
  await page.getByRole("button", { name: "Show the primers of tree" }).click();
  await expect(page.locator("tr.child")).toHaveCount(2);
  await expect(page.locator("tr.child").first()).toContainText(FWD);

  // Filtering by a primer's name finds its sequence and shows only that primer.
  await page.getByPlaceholder("Filter sequences and primers").fill("tree-R");
  await expect(page.locator("tr.child")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open tree", exact: true })).toBeVisible();
  await page.getByPlaceholder("Filter sequences and primers").fill("");

  // A primer row opens its sequence with the primer's site selected.
  await page.getByRole("button", { name: "Open tree at primer tree-R" }).click();
  await expect(page.locator(".crumb-name")).toHaveText("tree");
  await expect(selectionText(page)).toContainText("81–100 · 20 bp");
  await expect(page.locator("#tab-primers")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tab-body li.selected")).toContainText("tree-R");
});
