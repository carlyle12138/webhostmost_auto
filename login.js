const fs = require('fs');
const puppeteer = require('puppeteer');

function formatToISO(date) {
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
    let browser;
    let page; // Declare page here to use in potential error screenshot

    try {
      browser = await puppeteer.launch({ headless: false }); // Consider headless: 'new' or true
      page = await browser.newPage();

      let url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;
      console.log(`登录地址：${url}`);
      const usernameSelector = 'input[id="username"]';
      const passwordSelector = 'input[id="password"]';
      const loginButtonSelector = 'button[type="submit"]';

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.waitForSelector(usernameSelector, { visible: true, timeout: 30000 });
      console.log(`Found username input: ${usernameSelector}`);

      await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.value = '';
      }, usernameSelector);

      await page.type(usernameSelector, username);
      await page.type(passwordSelector, password);

      console.log(`准备点击登录按钮`);
      // Click the login button
      await page.click(loginButtonSelector);
      console.log(`登录按钮已点击，等待页面跳转或内容变化`);

      // Wait for the URL to contain '/evo/' which indicates successful redirection to the dashboard
      // This is more robust than waitForNavigation in cases of XHR logins + multiple redirects
      const dashboardUrlPart = '/evo/';
      try {
        await page.waitForFunction(
          (expectedUrlPart) => window.location.pathname.includes(expectedUrlPart),
          { timeout: 45000 }, // Increased timeout
          dashboardUrlPart
        );
        console.log(`成功导航到包含 "${dashboardUrlPart}" 的URL. 当前URL: ${page.url()}`);
      } catch (navError) {
        console.error(`等待URL包含 "${dashboardUrlPart}" 时超时或出错. 当前URL: ${page.url()}`);
        // If waitForFunction fails, it's a strong indicator login didn't proceed as expected
        // Take a screenshot before throwing to see the page state
        const navFailureScreenshotPath = `nav_failure_${username}_${Date.now()}.png`;
        await page.screenshot({ path: navFailureScreenshotPath, fullPage: true });
        console.error(`Navigation failure screenshot: ${navFailureScreenshotPath}`);
        throw navError; // Re-throw the error to be caught by the main try-catch
      }

      // At this point, we should be on the dashboard page if waitForFunction succeeded
      // You can add an additional waitForSelector for a specific dashboard element if needed for extra certainty
      // e.g., await page.waitForSelector('.dashboard-specific-element', { visible: true, timeout: 10000 });

      const isLoggedIn = await page.evaluate(() => {
        const logoutButton = document.querySelector('button[title="Logout"], a[href*="logout"]'); // Adjust selector
        return logoutButton !== null;
      });

      console.log(`登录状态：${isLoggedIn}`);

      if (isLoggedIn) {
        const nowUtc = formatToISO(new Date());
        const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
        console.log(`账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`);
      } else {
        const failureScreenshotPath = `login_failure_${username}_${Date.now()}.png`;
        await page.screenshot({ path: failureScreenshotPath, fullPage: true });
        console.error(`账号 ${username} 登录失败 (未找到登出按钮). 请检查凭据或页面结构. Screenshot: ${failureScreenshotPath}`);
        console.error(`Current URL after attempted login: ${page.url()}`);
      }
    } catch (error) {
      console.error(`账号 ${username} 登录时出现错误: ${error}`);
      if (error.name === 'TimeoutError') {
        console.error('A timeout occurred. The page might not have loaded correctly, or an element was not found, or navigation took too long.');
      }
      if (page && !page.isClosed()) {
          try {
            const errorScreenshotPath = `error_${username}_${Date.now()}.png`;
            await page.screenshot({ path: errorScreenshotPath, fullPage: true });
            console.error(`Screenshot taken on error: ${errorScreenshotPath}`);
            console.error(`URL at time of error: ${page.url()}`);
          } catch (screenshotError) {
            console.error(`Could not take screenshot on error: ${screenshotError}`);
          }
      }
    } finally {
      if (browser) {
        await browser.close();
      }
      const delay = Math.floor(Math.random() * 8000) + 1000;
      console.log(`Waiting for ${delay / 1000} seconds before next account...`);
      await delayTime(delay);
    }
  }
  console.log('所有账号登录完成！');
})();
