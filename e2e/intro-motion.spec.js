import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });

test.use({
  headless: false,
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
});

test('a fresh WebGL load moves the camera and shows walkers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/k12-intro-0.png` });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${shots}/k12-intro-1.png` });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shots}/k12-intro-2.png` });
  const motion = await page.evaluate(() => ({
    gl: window.__gl || null,
    intro: document.body.dataset.intro || '',
    points: Array.isArray(window.__introMotion) ? window.__introMotion.length : 0,
    walkers: [window.CAST?.robot, window.CAST?.stranger, window.CAST?.ferryman, ...(window.CAST?.knights || []), ...(window.CAST?.wander || [])].filter(Boolean).length,
    fb: document.body.classList.contains('fb'),
  }));
  expect(motion.gl?.ok, JSON.stringify(motion)).toBe(true);
  expect(motion.fb, JSON.stringify(motion)).toBe(false);
  expect(motion.points, JSON.stringify(motion)).toBeGreaterThan(1);
  expect(motion.walkers, JSON.stringify(motion)).toBeGreaterThan(0);
});
