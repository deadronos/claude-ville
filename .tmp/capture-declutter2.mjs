import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';

const baseUrl = 'http://localhost:3001';
const desktopViewport = { width: 1440, height: 960 };
const mobileViewport = { width: 390, height: 844 };
const paths = {
  home: 'docs/assets/review-declutter2-home.png',
  dashboard: 'docs/assets/review-declutter2-dashboard.png',
  mobile: 'docs/assets/review-declutter2-mobile.png',
};

async function prepare(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await prepare(page);
  await page.screenshot({ path: paths.home, fullPage: true });

  const dashboardButton = page.locator('#btnModeDashboard');
  if (await dashboardButton.count()) {
    await dashboardButton.first().click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
  await page.screenshot({ path: paths.dashboard, fullPage: true });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: mobileViewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  });
  const mobilePage = await mobile.newPage();
  await prepare(mobilePage);
  await mobilePage.screenshot({ path: paths.mobile, fullPage: true });
  await mobile.close();

  for (const path of Object.values(paths)) {
    const stat = await fs.stat(path);
    console.log(path);
    console.log(`${stat.size} bytes`);
  }
} finally {
  await browser.close();
}
