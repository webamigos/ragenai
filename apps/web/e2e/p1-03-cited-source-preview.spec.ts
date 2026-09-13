import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { AUTH_FILE, TEST_THREAD_ID } from './constants';
import { ROUTES, mockChatStream } from './helpers';

test.use({ storageState: AUTH_FILE });

/**
 * Following a citation to the paragraph it came from.
 *
 * The unit tests cover each link of the chain on its own — the worker's
 * conversion, the chunk's regions, the wire contract, the overlay's geometry —
 * with react-pdf mocked, because jsdom has no canvas and no worker. This is the
 * one place a real pdf.js runs: it loads its worker from `/_next/static/media`,
 * rasterises a page, and the overlay lands on top of it. If that wiring breaks,
 * nothing else in the suite notices.
 *
 * `p1`, not `p0`: this is a new panel over the chat, not a core screen. A PR
 * runs only smoke and p0, so this gates the nightly rather than the merge —
 * stated so nobody later wonders why a failure here did not block a PR.
 *
 * Both fixtures are fakes on purpose. The stream is mocked (no LLM in CI) and
 * the file route serves the eval PDF rather than a seeded upload, so the test
 * does not depend on object storage. What is real is everything in between: the
 * store, the sources block, the portal, the viewer and pdf.js.
 */
// From `import.meta.url`, not `__dirname`: this suite is ESM and the
// transpiled `__dirname` resolves somewhere else entirely.
const HERE = dirname(fileURLToPath(import.meta.url));
const PDF = readFileSync(
  join(HERE, '..', 'evals/e2e-rag/fixtures/regulamin-wilczy-mlyn.pdf'),
);

const FILE_ID = 'cited-file-001';
const ANSWER =
  'The reimbursement limit for an external monitor is stated in the regulations.';

/** A source with a page and a box, as the worker would have written it. */
const RETRIEVAL = {
  sources: [
    {
      fileId: FILE_ID,
      fileName: 'regulamin-wilczy-mlyn.pdf',
      chunkCount: 2,
      sourcePage: 1,
      snippet: 'Limit zwrotu kosztow zakupu monitora zewnetrznego',
      // The first element of the real parse, normalised: a header 2.5% down a
      // 792-point page, spanning almost the full column.
      sourceRegions: [{ page: 1, x: 0.0271, y: 0.0248, w: 0.9413, h: 0.0447 }],
    },
  ],
  chunkCount: 2,
  durationMs: 140,
};

test.describe('Following a citation into the document', () => {
  test.beforeEach(async ({ page }) => {
    // `/api/messages/**` is deliberately left alone. p0-23's new-thread test
    // blocks it to dodge a race, and that also leaves the composer disabled
    // for the rest of the run — `useApi`'s loading state never resolves. This
    // suite types into the composer, so it uses the seeded thread instead,
    // where the history fetch lands on mount, well before the stream.
    await page.route(`**/api/files/${FILE_ID}`, (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="regulamin.pdf"',
        },
        body: PDF,
      }),
    );
    await mockChatStream(page, {
      content: ANSWER,
      retrieval: RETRIEVAL,
      citedFileIds: [FILE_ID],
    });
  });

  test('opens the cited document at its page with the passage highlighted', async ({
    page,
  }) => {
    await page.goto(`${ROUTES.chats}/${TEST_THREAD_ID}`);
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 });

    await page.locator('textarea').fill('What is the monitor limit?');
    await page.locator('textarea').press('Enter');

    // The sources block, from the `retrieval` event the mock sends ahead of
    // the first token.
    const sourceCard = page.getByRole('button', {
      name: /regulamin-wilczy-mlyn\.pdf/,
    });
    await expect(sourceCard).toBeVisible({ timeout: 30_000 });

    await sourceCard.click();

    const preview = page.getByRole('dialog', {
      name: 'regulamin-wilczy-mlyn.pdf',
    });
    await expect(preview).toBeVisible({ timeout: 10_000 });

    // pdf.js actually rendered. `.react-pdf__Page__canvas` only exists once a
    // page has been rasterised by the worker, so this is the assertion that
    // the worker loaded — the thing no unit test can check.
    await expect(preview.locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });

    // The rectangle is on it, at the fraction the worker computed, and it is
    // hidden from assistive technology — the legend beside it carries the
    // meaning.
    const highlight = preview.getByTestId('pdf-highlights');
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveAttribute('aria-hidden', 'true');

    const box = highlight.locator('div').first();
    const placement = await box.evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
      width: (element as HTMLElement).style.width,
    }));
    expect(placement).toEqual({
      left: '2.71%',
      top: '2.48%',
      width: '94.13%',
    });

    // And it is drawn over the page rather than beside it: the box's own
    // rectangle sits inside the canvas's.
    const canvasBox = await preview.locator('canvas').first().boundingBox();
    const highlightBox = await box.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(highlightBox).not.toBeNull();
    expect(highlightBox!.x).toBeGreaterThanOrEqual(canvasBox!.x - 1);
    expect(highlightBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);
    expect(highlightBox!.x + highlightBox!.width).toBeLessThanOrEqual(
      canvasBox!.x + canvasBox!.width + 1,
    );

    // `initialPage` is not asserted here: this fixture is one page, so there
    // is no wrong page to land on. The unit tests cover opening at a page,
    // clamping past the end, and following a second citation.
  });

  test('closes the preview and leaves the thread as it was', async ({
    page,
  }) => {
    await page.goto(`${ROUTES.chats}/${TEST_THREAD_ID}`);
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 });

    await page.locator('textarea').fill('What is the monitor limit?');
    await page.locator('textarea').press('Enter');

    const sourceCard = page.getByRole('button', {
      name: /regulamin-wilczy-mlyn\.pdf/,
    });
    await expect(sourceCard).toBeVisible({ timeout: 30_000 });
    await sourceCard.click();

    const preview = page.getByRole('dialog', {
      name: 'regulamin-wilczy-mlyn.pdf',
    });
    await expect(preview).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');

    await expect(preview).not.toBeVisible({ timeout: 5_000 });
    // The answer is still there. The panel is a portal over the thread, not a
    // navigation away from it.
    await expect(page.locator('main').getByText(ANSWER)).toBeVisible();
  });
});
