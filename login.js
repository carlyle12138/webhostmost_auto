const fs = require('fs');
const puppeteer = require('puppeteer');

// Replicates the original's actual output format: YYYY-MM-DD HH:MM:SS.mmm
function formatToISO(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  // Read accounts.json
  let accounts;
  try {
    const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
    accounts = JSON.parse(accountsJson);
    if (!Array.isArray(accounts)) {
        throw new Error('accounts.json should contain a JSON array.');
    }
  } catch (error) {
    console.error('Error reading or parsing accounts.json:', error.message);
    console.error('Please ensure accounts.json exists, is valid JSON, and contains an array of accounts.');
    process.exit(1); // Exit if accounts file is problematic
  }


  for (const account of accounts) {
    const { username, password, panelnum } = account;

    if (!username || !password || !panelnum) {
        console.warn(`Skipping account entry due to missing username, password, or panelnum: ${JSON.stringify(account)}`);
        continue;
    }

    // For GitHub Actions or headless environments, set headless: true and add appropriate args.
    // e.g. { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Construct the URL for webhostmost.com
    let url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;

    try {
      console.log(`Attempting to login for ${username} on ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0' }); // More robust wait

      // Selectors for webhostmost.com DirectAdmin Evolution login
      const usernameSelector = 'input[name="username"]';
      const passwordSelector = 'input[name="password"]';
      const loginButtonSelector = 'button[type="submit"]'; // Common for DA Evo

      // Wait for the username input to be available
      await page.waitForSelector(usernameSelector, { visible: true });

      // Clear username input field (emulating original script's behavior)
      const usernameInput = await page.$(usernameSelector);
      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 }); // Select existing content
        await usernameInput.press('Backspace');      // Delete it
        await usernameInput.type(username);
      } else {
        throw new Error(`Username input field ('${usernameSelector}') not found.`);
      }

      // Type password
      await page.waitForSelector(passwordSelector, { visible: true });
      await page.type(passwordSelector, password);

      // Submit login form
      const loginButton = await page.$(loginButtonSelector);
      if (loginButton) {
        // It's often better to combine click and navigation waiting
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }), // Wait for navigation to complete
          loginButton.click(),
        ]);
      } else {
        throw new Error(`Login button ('${loginButtonSelector}') not found.`);
      }

      // Check if login was successful by looking for a logout link (common in DirectAdmin)
      const isLoggedIn = await page.evaluate(() => {
        // DirectAdmin Evolution typically has a logout link containing CMD_LOGOUT
        const logoutButton = document.querySelector('a[href*="CMD_LOGOUT"]');
        return logoutButton !== null;
      });

      if (isLoggedIn) {
        const nowUtc = formatToISO(new Date()); // UTC time (as per original behavior of new Date() then format)
        const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000)); // Beijing time
        console.log(`Account ${username} successfully logged in at Beijing time ${nowBeijing} (UTC time ${nowUtc}).`);
      } else {
        // Try to get current URL if login failed to provide more context
        const currentUrl = page.url();
        console.error(`Account ${username} login failed. Please check credentials. Current URL: ${currentUrl}`);
      }
    } catch (error) {
      const currentUrlAttempt = page ? page.url() : 'N/A';
      console.error(`Error during login for account ${username}: ${error.message}. Current URL: ${currentUrlAttempt}`);
    } finally {
      // Close page and browser
      if (page) await page.close();
      if (browser) await browser.close();

      // Random delay between users
      const delay = Math.floor(Math.random() * 7000) + 1000; // 1 to 8 seconds
      console.log(`Waiting for ${delay / 1000} seconds before processing next account...`);
      await delayTime(delay);
    }
  }

  console.log('All accounts processed.');
})();
