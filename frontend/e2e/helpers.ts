import { expect, type APIRequestContext, type Page } from "@playwright/test";

// 120 bp with no coding sequence, so edits never meet the reading-frame rule.
export const SEQ =
  "TTGACAGCTAGCTCAGTCCTAGGTATAATGCTAGCAAGGAGGTACCTTTAAGAATTCGGATCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC";

/** Create a record through the engine and open it in the UI. */
export async function openNewRecord(
  page: Page,
  request: APIRequestContext,
  name: string,
  sequence = SEQ,
  isCircular = true,
) {
  const res = await request.post("/api/records", { data: { name, sequence, isCircular } });
  expect(res.ok()).toBeTruthy();
  const record = await res.json();
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(page.locator(".crumb-name")).toHaveText(name);
  return record as { id: string; length: number };
}

/** The record as the engine holds it now. */
export async function fetchRecord(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/records/${id}`);
  return (await res.json()) as {
    name: string;
    sequence: string;
    length: number;
    isCircular: boolean;
    features: { name: string; start: number; end: number }[];
    primers: { name: string; sequence: string; bindStart: number | null }[];
    history: { description: string }[];
  };
}

/** Click in the sequence view just before the base at 0-based `index` on the first line. */
export async function placeCursor(page: Page, index: number) {
  const viewer = page.locator(".seq-viewer");
  const box = (await viewer.boundingBox())!;
  const geometry = await page.evaluate(() => {
    const probe = document.querySelector(".seq-probe")!.getBoundingClientRect();
    const first = document.querySelector(".seq-line")!.getBoundingClientRect();
    return { cw: probe.width / 10, top: first.top };
  });
  // The gutter is (digits + 2) characters wide after a 14 px pad; every ten
  // bases are followed by a blank column.
  const length = Number((await page.locator(".crumb-meta").innerText()).replace(/[^\d]/g, ""));
  const gutter = (String(length).length + 2) * geometry.cw;
  const col = index + Math.floor(index / 10);
  await page.mouse.click(box.x + 14 + gutter + col * geometry.cw + 1, geometry.top + 8);
}

export const selectionText = (page: Page) => page.locator(".statusbar .sel");
