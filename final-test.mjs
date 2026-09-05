import puppeteer from 'puppeteer';

const BASE_URL = 'http://127.0.0.1:43151';
const EMAIL = `storyui${Date.now() % 100000}@nixo.test`;

console.log(`Starting test with email: ${EMAIL}`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function screenshot(page, name) {
  await page.screenshot({ path: `/tmp/screenshots/${name}.png` });
  console.log(`  📸 Screenshot: ${name}.png`);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  try {
    console.log('\n1️⃣  Opening NIXO...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await screenshot(page, '01-homepage');
    await sleep(1000);

    console.log('\n2️⃣  Clicking Register...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const regBtn = btns.find(b => b.textContent.includes('ثبت') && b.textContent.includes('کد'));
      if (regBtn) regBtn.click();
    });
    await sleep(2000);
    await screenshot(page, '02-register-form');

    console.log('\n3️⃣  Switching to email...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const emailBtn = btns.find(b => b.textContent.includes('تغییر') && b.textContent.includes('ایمیل'));
      if (emailBtn) emailBtn.click();
    });
    await sleep(1500);
    await screenshot(page, '03-switched-to-email');

    console.log('\n4️⃣  Entering email...');
    const emailInput = await page.$('input');
    if (emailInput) {
      await emailInput.click();
      await emailInput.type(EMAIL, { delay: 100 });
    }
    await sleep(1500);
    await screenshot(page, '04-email-filled');

    console.log('\n5️⃣  Clicking Send Code...');
    await page.keyboard.press('Tab'); // Tab to button
    await page.keyboard.press('Enter'); // Press Enter
    await sleep(4000);
    await screenshot(page, '05-code-sent');

    console.log('\n6️⃣  Scrolling to find inbox button...');
    await page.evaluate(() => window.scrollTo(0, 600));
    await sleep(1500);
    await screenshot(page, '06-scrolled');

    console.log('\n7️⃣  Clicking demo inbox button...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const inboxBtn = btns.find(b => 
        b.textContent.includes('نمایش') || 
        b.textContent.includes('صندوق') ||
        b.textContent.includes('آزمایش')
      );
      if (inboxBtn) inboxBtn.click();
    });
    await sleep(2000);
    await screenshot(page, '07-inbox-opened');

    console.log('\n8️⃣  Extracting OTP...');
    const bodyText = await page.evaluate(() => document.body.innerText);
    const bodyHtml = await page.content();
    
    // Save HTML for debugging
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/page-content.html', bodyHtml);
    await fs.writeFile('/tmp/page-text.txt', bodyText);
    
    console.log(`  Page text sample: ${bodyText.substring(0, 500)}`);
    
    const codeMatch = bodyText.match(/(\d{6})/g);
    const code = codeMatch ? codeMatch[codeMatch.length - 1] : null;
    console.log(`  🔑 OTP Code: ${code}`);
    console.log(`  All 6-digit matches: ${codeMatch}`);

    if (!code) {
      console.error('❌ Could not extract OTP!');
      await screenshot(page, 'ERROR-no-otp');
      await browser.close();
      return;
    }

    console.log('\n9️⃣  Entering OTP...');
    await page.evaluate((otp) => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      if (inputs.length >= 6) {
        // Individual boxes
        otp.split('').forEach((digit, i) => {
          if (inputs[i]) {
            inputs[i].value = digit;
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      } else if (inputs[0]) {
        // Single input
        inputs[0].value = otp;
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, code);
    await sleep(1500);
    await screenshot(page, '08-otp-entered');

    console.log('\n9️⃣  Submitting OTP...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = btns.find(b => b.textContent.includes('تایید'));
      if (confirmBtn) confirmBtn.click();
    });
    await sleep(3000);
    await screenshot(page, '09-otp-submitted');

    console.log('\n🔟 Filling profile...');
    await sleep(2000);
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      if (inputs.length >= 3) {
        inputs[0].value = 'استوری';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[1].value = 'آزمایش';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[2].value = `storyui${Date.now() % 10000}`;
        inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(1500);
    await screenshot(page, '10-profile-filled');

    console.log('\n1️⃣1️⃣  Submitting profile...');
    await page.evaluate(() => {
      const submitBtns = Array.from(document.querySelectorAll('button[type="submit"]'));
      if (submitBtns.length) submitBtns[submitBtns.length - 1].click();
    });
    await sleep(5000);
    await screenshot(page, '11-app-loaded');

    console.log('\n1️⃣2️⃣  Opening Updates/Stories tab...');
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      const updatesLink = links.find(l => 
        l.textContent.includes('بروزرسانی') || 
        l.textContent.includes('استوری') ||
        l.textContent.includes('Status')
      );
      if (updatesLink) updatesLink.click();
    });
    await sleep(2500);
    await screenshot(page, '12-updates-tab');

    console.log('\n1️⃣3️⃣  Clicking Add Story button...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const addBtn = btns.find(b => 
        (b.getAttribute('aria-label') || '').includes('add') ||
        b.textContent.includes('افزودن') ||
        b.textContent.trim() === '+'
      );
      if (addBtn) addBtn.click();
    });
    await sleep(2500);
    await screenshot(page, '13-create-story-opened');

    console.log('\n1️⃣4️⃣  Checking type grid...');
    await sleep(1000);
    await screenshot(page, '14-type-grid');

    console.log('\n1️⃣5️⃣  Clicking Text type...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const textBtn = btns.find(b => b.textContent.includes('متن'));
      if (textBtn) textBtn.click();
    });
    await sleep(2500);
    await screenshot(page, '15-text-editor');

    console.log('\n1️⃣6️⃣  Testing tabs...');
    for (const tabName of ['ظاهر', 'استیکر', 'موسیقی']) {
      console.log(`  Clicking tab: ${tabName}`);
      await page.evaluate((name) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.textContent?.trim() === name);
        if (tab) tab.click();
      }, tabName);
      await sleep(1500);
      await screenshot(page, `16-tab-${tabName}`);
    }

    console.log('\n✅ Test completed successfully!');
    console.log('📁 Screenshots saved to /tmp/screenshots/');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await screenshot(page, 'ERROR-exception');
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
