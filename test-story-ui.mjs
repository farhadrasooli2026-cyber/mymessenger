import puppeteer from 'puppeteer';
import { writeFile } from 'fs/promises';

const BASE_URL = 'http://127.0.0.1:43151';
const EMAIL = 'storyui84821@nixo.test';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: '/usr/local/bin/google-chrome'
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  
  console.log('1. Navigate to registration page...');
  await page.goto(BASE_URL);
  await page.screenshot({ path: '/tmp/screenshots/01-landing.png' });
  await wait(1000);

  console.log('2. Click Register button (ثبت نام با کد)...');
  const registerBtns = await page.$$('button');
  for (const btn of registerBtns) {
    const text = await btn.evaluate(el => el.textContent);
    if (text.includes('ثبت نام') || text.includes('کد')) {
      await btn.click();
      break;
    }
  }
  await wait(1000);
  await page.screenshot({ path: '/tmp/screenshots/02-register-form.png' });

  console.log('3. Enter email...');
  const emailInput = await page.$('input[type="text"], input[placeholder*="موبایل"]');
  if (emailInput) {
    await emailInput.click();
    await emailInput.type(EMAIL);
  }
  await wait(500);
  await page.screenshot({ path: '/tmp/screenshots/03-email-entered.png' });

  console.log('4. Submit code request...');
  const sendButtons = await page.$$('button');
  for (const btn of sendButtons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text.includes('ارسال') || text.includes('کد')) {
      await btn.click();
      break;
    }
  }
  await wait(2000);
  await page.screenshot({ path: '/tmp/screenshots/04-code-sent.png' });

  console.log('5. Looking for demo inbox button...');
  await wait(2000); // Wait for buttons to appear
  const allButtons = await page.$$('button');
  console.log('Total buttons:', allButtons.length);
  const buttonTexts = [];
  for (const btn of allButtons) {
    const text = await btn.evaluate(el => el.textContent);
    buttonTexts.push(text);
  }
  console.log('Button texts:', buttonTexts);
  
  console.log('6. Click demo inbox button...');
  let inboxClicked = false;
  for (const btn of allButtons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text.includes('نمایش') || text.includes('صندوق') || text.includes('آزمایش')) {
      console.log('Clicking inbox button:', text);
      await btn.click();
      inboxClicked = true;
      break;
    }
  }
  await wait(2000);
  await page.screenshot({ path: '/tmp/screenshots/05-inbox-opened.png' });
  
  if (!inboxClicked) {
    console.log('Inbox button not found, scrolling down...');
    await page.evaluate(() => window.scrollBy(0, 300));
    await wait(1000);
    await page.screenshot({ path: '/tmp/screenshots/05-scrolled.png' });
  }

  console.log('7. Extract OTP code...');
  await page.waitForSelector('pre, code, [class*="inbox"]', { timeout: 5000 }).catch(() => {});
  const bodyText = await page.evaluate(() => document.body.textContent);
  console.log('Body text sample:', bodyText.substring(0, 500));
  const codeMatch = bodyText.match(/NIXO[:\s]*(\d{6})|کد[:\s]*(\d{6})|\b(\d{6})\b/);
  const otpCode = codeMatch ? (codeMatch[1] || codeMatch[2] || codeMatch[3]) : null;
  console.log('OTP Code:', otpCode);

  if (!otpCode) {
    console.error('Failed to extract OTP code. Taking debug screenshot...');
    await page.screenshot({ path: '/tmp/screenshots/05-debug-body.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('8. Enter OTP code...');
  const codeInputs = await page.$$('input[type="text"]');
  if (codeInputs.length >= 6) {
    for (let i = 0; i < 6; i++) {
      await codeInputs[i].type(otpCode[i]);
      await wait(100);
    }
  } else {
    // Try single input
    const firstInput = codeInputs[0];
    if (firstInput) {
      await firstInput.click();
      await firstInput.type(otpCode);
    }
  }
  await wait(1000);
  await page.screenshot({ path: '/tmp/screenshots/06-otp-entered.png' });

  console.log('9. Submit OTP...');
  const confirmButtons = await page.$$('button');
  for (const btn of confirmButtons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text.includes('تایید')) {
      await btn.click();
      break;
    }
  }
  await wait(2000);
  await page.screenshot({ path: '/tmp/screenshots/07-otp-submitted.png' });

  console.log('10. Fill profile form...');
  await wait(1000);
  const inputs = await page.$$('input');
  if (inputs.length >= 3) {
    await inputs[0].type('استوری');
    await wait(300);
    await inputs[1].type('آزمایش');
    await wait(300);
    await inputs[2].type('storyui84821');
    await wait(500);
  }
  await page.screenshot({ path: '/tmp/screenshots/08-profile-filled.png' });

  console.log('11. Submit profile...');
  const submitButtons = await page.$$('button[type="submit"]');
  if (submitButtons.length > 0) {
    await submitButtons[0].click();
    await wait(3000);
  }
  await page.screenshot({ path: '/tmp/screenshots/09-profile-submitted.png' });

  console.log('12. Wait for app to load...');
  await wait(3000);
  await page.screenshot({ path: '/tmp/screenshots/10-app-loaded.png' });

  console.log('13. Navigate to Updates/Status tab...');
  const tabs = await page.$$('button, a');
  for (const tab of tabs) {
    const text = await tab.evaluate(el => el.textContent);
    if (text.includes('بروزرسانی') || text.includes('Status') || text.includes('استوری')) {
      await tab.click();
      await wait(1000);
      break;
    }
  }
  await page.screenshot({ path: '/tmp/screenshots/11-updates-tab.png' });

  console.log('14. Click Add Status button...');
  const addButtons = await page.$$('button');
  for (const btn of addButtons) {
    const text = await btn.evaluate(el => el.textContent);
    const aria = await btn.evaluate(el => el.getAttribute('aria-label') || '');
    if (text.includes('افزودن') || text.includes('استوری') || aria.includes('add') || text === '+') {
      await btn.click();
      await wait(2000);
      break;
    }
  }
  await page.screenshot({ path: '/tmp/screenshots/12-create-story-opened.png' });

  console.log('15. Check type grid...');
  await wait(1000);
  await page.screenshot({ path: '/tmp/screenshots/13-type-grid.png' });

  console.log('16. Click متن (text) type...');
  const typeButtons = await page.$$('button');
  for (const btn of typeButtons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text.includes('متن')) {
      await btn.click();
      await wait(2000);
      break;
    }
  }
  await page.screenshot({ path: '/tmp/screenshots/14-text-editor-opened.png' });

  console.log('17. Check for tabs and preview...');
  await wait(1000);
  const tabButtons = await page.$$('button');
  const tabTexts = [];
  for (const btn of tabButtons) {
    const text = await btn.evaluate(el => el.textContent?.trim());
    if (text && (text === 'متن' || text === 'ظاهر' || text === 'استیکر' || text === 'موسیقی')) {
      tabTexts.push(text);
    }
  }
  console.log('Found tabs:', tabTexts);

  console.log('18. Click each tab...');
  for (const tabName of ['ظاهر', 'استیکر', 'موسیقی']) {
    for (const btn of tabButtons) {
      const text = await btn.evaluate(el => el.textContent?.trim());
      if (text === tabName) {
        await btn.click();
        await wait(1000);
        await page.screenshot({ path: `/tmp/screenshots/15-tab-${tabName}.png` });
        break;
      }
    }
  }

  console.log('19. Final screenshot...');
  await wait(1000);
  await page.screenshot({ path: '/tmp/screenshots/16-final.png' });

  console.log('Complete! Screenshots saved to /tmp/screenshots/');
  
  await browser.close();
}

main().catch(console.error);
