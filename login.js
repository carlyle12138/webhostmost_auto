const fs = require('fs');
const puppeteer = require('puppeteer');

function formatToISO(date) {
  // Simpler way to get YYYY-MM-DD HH:MM:SS from ISO string
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
  const accounts = JSON.parse(accountsJson);

  for (const account of accounts) {
    const { username, password, panelnum } = account;
    let browser; // Declare browser outside try so it can be accessed in finally

    try {
      browser = await puppeteer.launch({ headless: false }); // Consider headless: 'new' or true for production
      const page = await browser.newPage();

      let url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;
      console.log(`登录地址：${url}`);
      const usernameSelector = 'input[id="username"]';
      const passwordSelector = 'input[id="password"]';
      const loginButtonSelector = 'button[type="submit"]'; // More robust to use a selector string

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 }); // Wait until network is idle
      await page.waitForSelector(usernameSelector, { visible: true, timeout: 30000 });
      console.log(`Found username input: ${usernameSelector}`);

      // Clear username input (more robust way)
      await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.value = '';
      }, usernameSelector);

      // Input actual username and password
      await page.type(usernameSelector, username);
      await page.type(passwordSelector, password);

      console.log(`提交登录，等待跳转`);

      // Click the login button and wait for navigation to complete
      // This is the key change:
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), // Wait for navigation to complete
        page.click(loginButtonSelector), // Click the button to trigger navigation
      ]);

      console.log('Navigation presumably complete. Checking login status.');

      // Check if login was successful by looking for a logout button or another element
      // that only appears after successful login.
      const isLoggedIn = await page.evaluate(() => {
        // Adjust selector if needed, e.g., based on what appears on the dashboard
        const logoutButton = document.querySelector('a[href*="logout"], button[title*="Logout"], a[data-method="POST"][href*="logout"]');
        // Or check for a specific element on the dashboard
        // const dashboardElement = document.querySelector('.dashboard-welcome-message');
        return logoutButton !== null; // || dashboardElement !== null;
      });

      console.log(`登录状态：${isLoggedIn}`);

      if (isLoggedIn) {
        const nowUtc = formatToISO(new Date());
        const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
        console.log(`账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`);
      } else {
        // It's good to take a screenshot on failure for debugging
        const failureScreenshotPath = `login_failure_${username}_${Date.now()}.png`;
        await page.screenshot({ path: failureScreenshotPath });
        console.error(`账号 ${username} 登录失败，请检查账号和密码是否正确。Screenshot: ${failureScreenshotPath}`);
        // You might want to log the current URL or page content here
        console.error(`Current URL: ${page.url()}`);
      }
    } catch (error) {
      console.error(`账号 ${username} 登录时出现错误: ${error}`);
      if (error.name === 'TimeoutError') {
        console.error('A timeout occurred. The page might not have loaded correctly, or an element was not found, or navigation took too long.');
      }
      // Attempt to take a screenshot even on generic error
      if (typeof page !== 'undefined' && page && !page.isClosed()) {
          try {
            const errorScreenshotPath = `error_${username}_${Date.now()}.png`;
            await page.screenshot({ path: errorScreenshotPath });
            console.error(`Screenshot taken on error: ${errorScreenshotPath}`);
          } catch (screenshotError) {
            console.error(`Could not take screenshot on error: ${screenshotError}`);
          }
      }
    } finally {
      if (browser) { // Check if browser was initialized
        await browser.close();
      }

      const delay = Math.floor(Math.random() * 8000) + 1000;
      console.log(`Waiting for ${delay / 1000} seconds before next account...`);
      await delayTime(delay);
    }
  }

  console.log('所有账号登录完成！');
})();
