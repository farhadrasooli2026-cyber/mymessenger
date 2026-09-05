import puppeteer from 'puppeteer';

const BASE_URL = 'http://127.0.0.1:43151';
const EMAIL = `storyui${Date.now() % 100000}@nixo.test`;

console.log('Using email:', EMAIL);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    
    console.log('Step 1: Go to homepage');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/screenshots/step1-homepage.png' });
    await sleep(1500);

    console.log('Step 2: Click Register button');
    await page.waitForSelector('button');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('ثبت') && text.includes('کد')) {
        await btn.click();
        break;
      }
    }
    await sleep(2000);
    await page.screenshot({ path: '/tmp/screenshots/step2-register-clicked.png' });

    console.log('Step 3: Fill email');
    const input = await page.$('input[type="text"], input[type="email"], input[placeholder*="موبایل"]');
    if (input) {
      await input.click();
      await input.type(EMAIL, { delay: 50 });
    }
    await sleep(1000);
    await page.screenshot({ path: '/tmp/screenshots/step3-email-filled.png' });

    console.log('Step 4: Click Send Code');
    const btns2 = await page.$$('button');
    for (const btn of btns2) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('ارسال') && text.includes('کد')) {
        await btn.click();
        break;
      }
    }
    await sleep(3000);
    await page.screenshot({ path: '/tmp/screenshots/step4-code-sent.png' });

    console.log('Step 5: Scroll and find inbox button');
    await page.evaluate(() => window.scrollTo(0, 500));
    await sleep(1000);
    await page.screenshot({ path: '/tmp/screenshots/step5-scrolled.png' });

    console.log('Step 6: Click demo inbox');
    const btns3 = await page.$$('button');
    for (const btn of btns3) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('نمایش') || text.includes('صندوق')) {
        await btn.click();
        await sleep(1500);
        break;
      }
    }
    await page.screenshot({ path: '/tmp/screenshots/step6-inbox-opened.png' });

    console.log('Step 7: Extract OTP');
    const fullText = await page.evaluate(() => document.body.innerText);
    const match = fullText.match(/(\d{6})/);
    const code = match ? match[1] : null;
    console.log('Found OTP:', code);

    if (!code) {
      console.error('Could not extract OTP. Saving page content...');
      await page.screenshot({ path: '/tmp/screenshots/ERROR-no-code.png', fullPage: true });
      return;
    }

    console.log('Step 8: Enter OTP');
    const codeInputs = await page.$$('input[type="text"]');
    if (codeInputs.length >= 1) {
      await codeInputs[0].click();
      for (const digit of code) {
        await page.keyboard.type(digit);
        await sleep(100);
      }
    }
    await sleep(1000);
    await page.screenshot({ path: '/tmp/screenshots/step8-otp-entered.png' });

    console.log('Step 9: Submit OTP');
    const btns4 = await page.$$('button');
    for (const btn of btns4) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('تایید')) {
        await btn.click();
        break;
      }
    }
    await sleep(3000);
    await page.screenshot({ path: '/tmp/screenshots/step9-otp-submitted.png' });

    console.log('Step 10: Fill profile');
    await sleep(2000);
    const inputs = await page.$$('input');
    if (inputs.length >= 3) {
      await inputs[0].type('استوری', { delay: 50 });
      await inputs[1].type('آزمایش', { delay: 50 });
      await inputs[2].type(`storyui${Date.now() % 10000}`, { delay: 50 });
    }
    await sleep(1000);
    await page.screenshot({ path: '/tmp/screenshots/step10-profile-filled.png' });

    console.log('Step 11: Submit profile');
    const btns5 = await page.$$('button[type="submit"]');
    if (btns5.length > 0) {
      await btns5[btns5.length - 1].click();
    }
    await sleep(5000);
    await page.screenshot({ path: '/tmp/screenshots/step11-app-loaded.png' });

    console.log('Step 12: Find Updates tab');
    await sleep(2000);
    const allLinks = await page.$$('a, button');
    for (const link of allLinks) {
      const text = await page.evaluate(el => el.textContent, link);
      if (text.includes('بروزرسانی') || text.includes('استوری')) {
        await link.click();
        await sleep(2000);
        break;
      }
    }
    await page.screenshot({ path: '/tmp/screenshots/step12-updates-tab.png' });

    console.log('Step 13: Click Add Story');
    const allBtns = await page.$$('button');
    for (const btn of allBtns) {
      const aria = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
      const text = await page.evaluate(el => el.textContent, btn);
      if (aria.includes('add') || text.includes('افزودن') || text === '+') {
        await btn.click();
        await sleep(2000);
        break;
      }
    }
    await page.screenshot({ path: '/tmp/screenshots/step13-story-composer-opened.png' });

    console.log('Step 14: Check type grid');
    await sleep(1000);
    await page.screenshot({ path: '/tmp/screenshots/step14-type-grid.png' });

    console.log('Step 15: Click Text type');
    const typeBtns = await page.$$('button');
    for (const btn of typeBtns) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('متن')) {
        await btn.click();
        await sleep(2000);
        break;
      }
    }
    await page.screenshot({ path: '/tmp/screenshots/step15-text-editor.png' });

    console.log('Step 16: Click each tab');
    for (const tabName of ['ظاهر', 'استیکر', 'موسیقی']) {
      const tabs = await page.$$('button');
      for (const tab of tabs) {
        const text = await page.evaluate(el => el.textContent?.trim(), tab);
        if (text === tabName) {
          await tab.click();
          await sleep(1500);
          await page.screenshot({ path: `/tmp/screenshots/step16-tab-${tabName}.png` });
          break;
        }
      }
    }

    console.log('Step 17: Final screenshot');
    await page.screenshot({ path: '/tmp/screenshots/step17-final.png' });

    console.log('✓ Test complete! Screenshots in /tmp/screenshots/');

  } catch (error) {
    console.error('Error during test:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
