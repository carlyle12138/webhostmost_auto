const fs = require('fs');
const puppeteer = require('puppeteer');

// Helper function to format date to a readable YYYY-MM-DD HH:MM:SS string
function formatReadableDateTime(date) {
  const pad = (num) => num.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Months are 0-indexed
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Helper function for delay
async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log("🚀 Starting WebHostMost Login Script...");
  let browser = null;

  // Define selectors (these are constant for this login page)
  const usernameSelector = 'input[name="username"]';
  const passwordSelector = 'input[name="password"]';
  const loginButtonSelector = 'button[type="submit"]';

  try {
    const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
    const accounts = JSON.parse(accountsJson);
    console.log(`ℹ️  Loaded ${accounts.length} account(s) from accounts.json.`);

    if (accounts.length === 0) {
        console.log("ℹ️  No accounts to process. Exiting.");
        return;
    }

    browser = await puppeteer.launch({ headless: 'new' }); // Use 'new' for modern headless
    console.log("ℹ️  Browser launched successfully.");

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const { username, password, panelnum } = account;
      let page = null;

      const logPrefix = `[Account: ${username} | Server: ${panelnum}]`;
      console.log(`\n➡️  Processing account ${i + 1}/${accounts.length}: ${username} on server${panelnum}`);

      try {
        page = await browser.newPage();
        const url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;
        console.log(`${logPrefix} Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        await page.waitForSelector(usernameSelector, { visible: true, timeout: 20000 });
        
        await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, usernameSelector);
        await page.type(usernameSelector, username);
        console.log(`${logPrefix} Entered username.`);
        
        await page.type(passwordSelector, password);
        console.log(`${logPrefix} Entered password.`);

        console.log(`${logPrefix} Clicking login button...`);
        const loginButton = await page.$(loginButtonSelector);
        if (!loginButton) {
            throw new Error(`Login button ('${loginButtonSelector}') not found on page.`);
        }

        await Promise.all([
          loginButton.click(),
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
            .catch(e => console.warn(`${logPrefix} Warning during navigation (or AJAX login): ${e.message.split('\n')[0]}. Proceeding with cookie check.`))
        ]);

        await delayTime(2500); // Brief pause to ensure page state and cookies are settled

        const cookies = await page.cookies();
        const sessionCookie = cookies.find(cookie => cookie.name === 'session');

        const nowUtc = formatReadableDateTime(new Date());
        const nowBeijing = formatReadableDateTime(new Date(Date.now() + 8 * 60 * 60 * 1000));

        if (sessionCookie) {
          console.log(`✅ ${logPrefix} Login SUCCEEDED.`);
          console.log(`   Logged in at (Beijing): ${nowBeijing}`);
          console.log(`   Logged in at (UTC):     ${nowUtc}`);
        } else {
          console.error(`❌ ${logPrefix} Login FAILED. 'session' cookie not found.`);
        }
      } catch (error) {
        console.error(`❌ ${logPrefix} An error occurred: ${error.message.split('\n')[0]}`);
      } finally {
        if (page) {
          await page.close();
          console.log(`${logPrefix} Page closed.`);
        }
        if (i < accounts.length - 1) { // No delay after the last account
          const delay = Math.floor(Math.random() * 5000) + 1000; // 1s to 6s delay
          console.log(`   --- Pausing for ${delay / 1000}s before next account ---`);
          await delayTime(delay);
        }
      }
    }
    console.log('\n🎉 All accounts processed.');

  } catch (error) {
    console.error(`\n❌ CRITICAL SCRIPT ERROR: ${error.message}`);
    console.error(error.stack); // For critical errors, stack trace is important
  } finally {
    if (browser) {
      await browser.close();
      console.log("ℹ️  Browser closed.");
    }
    console.log("🏁 Script finished.");
  }
})();
