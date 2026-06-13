import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('Console Error: ' + msg.text());
  });
  page.on('pageerror', err => {
    errors.push('Page Error: ' + err.message);
  });
  page.on('requestfailed', request => {
    errors.push('Request Failed: ' + request.url() + ' - ' + request.failure().errorText);
  });
  page.on('response', response => {
    if (!response.ok()) {
        errors.push('HTTP Error: ' + response.status() + ' ' + response.url());
    }
  });

  try {
    console.log('Navigating to login...');
    await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle' });
    
    await page.fill('input[type="email"]', 'admin@flux.com');
    await page.fill('input[type="password"]', 'admin123'); // Assume this works
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    console.log('Navigating to home...');
    await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
    
    console.log('Finding media item...');
    const mediaItem = await page.$('a[href^="/player/"]');
    if (mediaItem) {
        console.log('Clicking media item...');
        await mediaItem.click();
        await page.waitForTimeout(5000);
    } else {
        console.log('No media item found, trying hardcoded URL...');
        await page.goto('http://localhost:5174/player/dummy1', { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000);
    }
    
    console.log('--- ERRORS CAPTURED ---');
    console.log(JSON.stringify(errors, null, 2));
    
  } catch(e) {
    console.error('Script error:', e);
  } finally {
    await browser.close();
  }
})();
