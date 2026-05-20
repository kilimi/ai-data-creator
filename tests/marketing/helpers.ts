import { Page, TestInfo } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Helpers for marketing/demo capture.
 */

export const FLOWS_ROOT = path.join(process.cwd(), 'docs', 'flows');

/**
 * Save a screenshot under docs/flows/<flow-slug>/<NN>-<label>.png.
 * Call between meaningful user actions.
 */
export async function shot(
  page: Page,
  testInfo: TestInfo,
  label: string,
  opts: { fullPage?: boolean } = {},
) {
  const flowSlug = slugify(testInfo.title);
  const dir = path.join(FLOWS_ROOT, flowSlug);
  fs.mkdirSync(dir, { recursive: true });

  // Auto-incrementing step counter per test
  const count = ((testInfo as unknown as { _shotIdx?: number })._shotIdx ?? 0) + 1;
  (testInfo as unknown as { _shotIdx?: number })._shotIdx = count;
  const idx = String(count).padStart(2, '0');

  const file = path.join(dir, `${idx}-${slugify(label)}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log(`📸  ${path.relative(process.cwd(), file)}`);
}

/**
 * Inject a visible cursor ring so videos show where the user is "clicking".
 * Playwright's real cursor is not recorded by default.
 */
export async function installCursor(page: Page) {
  await page.addInitScript(() => {
    const id = '__demo_cursor__';
    const ensure = () => {
      if (document.getElementById(id)) return;
      const dot = document.createElement('div');
      dot.id = id;
      Object.assign(dot.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '22px',
        height: '22px',
        marginLeft: '-11px',
        marginTop: '-11px',
        borderRadius: '50%',
        background: 'rgba(59,130,246,0.35)',
        border: '2px solid rgba(59,130,246,0.9)',
        pointerEvents: 'none',
        zIndex: '2147483647',
        transition: 'transform 60ms linear',
        boxShadow: '0 0 12px rgba(59,130,246,0.6)',
      } as CSSStyleDeclaration);
      document.body.appendChild(dot);
    };
    const onMove = (e: MouseEvent) => {
      ensure();
      const dot = document.getElementById(id);
      if (dot) dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    const onDown = () => {
      ensure();
      const dot = document.getElementById(id);
      if (dot) dot.style.background = 'rgba(59,130,246,0.7)';
    };
    const onUp = () => {
      const dot = document.getElementById(id);
      if (dot) dot.style.background = 'rgba(59,130,246,0.35)';
    };
    window.addEventListener('DOMContentLoaded', ensure);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
  });
}

/**
 * Mock the training endpoints so flows can show "train a model" without
 * actually running training. Intercepts the backend API directly.
 */
export async function mockTraining(page: Page) {
  const apiBase = process.env.TEST_API_URL || 'http://localhost:9999';
  let taskId = 9001;

  await page.route(`${apiBase}/api/training/**`, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'POST' && /\/start$|\/rtdetr$|\/yolo/.test(url)) {
      taskId += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          task_id: taskId,
          status: 'queued',
          message: 'Training queued (mocked)',
        }),
      });
    }

    if (method === 'GET' && /\/status$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task_id: taskId,
          status: 'completed',
          progress: 100,
          metrics: { mAP50: 0.91, mAP5095: 0.74, precision: 0.93, recall: 0.88 },
        }),
      });
    }

    return route.continue();
  });
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
