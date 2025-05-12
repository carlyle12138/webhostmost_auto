const fs = require('fs');
const puppeteer = require('puppeteer');

// Helper function to format date to ISO-like string (YYYY-MM-DD HH:MM:SS)
function formatToISO(date) {
  // Pad single digits with leading zero
  const pad = (num) => num.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Months are 0-indexed
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Helper function for delays
async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let accounts;
  try {
    // Read accounts.json
    const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
    accounts = JSON.parse(accountsJson);
    if (!Array.isArray(accounts)) {
        throw new Error('accounts.json should contain a JSON array.');
    }
  } catch (error) {
    console.error('Error reading or parsing accounts.json:', error);
    process.exit(1); // Exit if accounts file is invalid
  }


  for (const account of accounts) {
    // Destructure account details, provide default panelnum if missing
    const { username, password, panelnum = '8' } = account; // Default to server 8 if panelnum is missing

    if (!username || !password || !panelnum) {
        console.warn(`Skipping account entry with missing details: ${JSON.stringify(account)}`);
        continue; // Skip this account if essential details are missing
    }

    console.log(`Attempting login for user: ${username} on server${panelnum}`);

    let browser; // Declare browser outside try block for access in finally
    let page;    // Declare page outside try block for access in finally

    // Construct the specific login URL for webhostmost
    const url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;

    try {
      browser = await puppeteer.launch({
          headless: false, // Set to true for background operation, false for debugging
          args: [
              '--no-sandbox', // Often needed in containerized/CI environments
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage', // Overcome limited resource problems
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              // '--single-process', // Use with caution, might be unstable
              '--disable-gpu' // Often needed in headless mode
          ],
          // Ignore HTTPS errors if the site uses self-signed certs (use with caution)
          ignoreHTTPSErrors: true
      });
      page = await browser.newPage();

      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });
      // Set a longer navigation timeout if needed
      await page.setDefaultNavigationTimeout(60000); // 60 seconds

      console.log(`Navigating to ${url} for user ${username}`);
      await page.goto(url, { waitUntil: 'networkidle2' }); // Wait until network is relatively idle

      // --- Login Steps for webhostmost.com ---

      // Wait for the login form elements to be present
      await page.waitForSelector('input[name="username"]', { visible: true });
      await page.waitForSelector('input[name="password"]', { visible: true });
      await page.waitForSelector('button[type="submit"]', { visible: true });

      // Clear and type username (clearing might not be necessary if fields are empty by default)
      const usernameInput = await page.$('input[name="username"]');
      if (usernameInput) {
          // Optional: Clear field if needed (DirectAdmin usually doesn't pre-fill)
          // await usernameInput.click({ clickCount: 3 });
          // await usernameInput.press('Backspace');
          await usernameInput.type(username);
      } else {
          throw new Error('Username input field (input[name="username"]) not found.');
      }

      // Type password
      const passwordInput = await page.$('input[name="password"]');
       if (passwordInput) {
          await passwordInput.type(password);
       } else {
           throw new Error('Password input field (input[name="password"]) not found.');
       }

      // Click the login button
      const loginButton = await page.$('button[type="submit"]');
      if (loginButton) {
          // Use Promise.all to click and wait for navigation simultaneously
          await Promise.all([
              page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), // Wait for navigation to complete after click
              loginButton.click(),
          ]);
      } else {
          throw new Error('Login button (button[type="submit"]) not found.');
      }

      // --- Verification Step ---
      // Check for an element that confirms successful login.
      // In DirectAdmin Evolution, a logout link is a good indicator.
      // We look for an anchor tag whose href contains CMD_LOGOUT.
      const isLoggedIn = await page.evaluate(() => {
          // Check if the URL itself has changed away from the login page
          const isOnLoginPage = window.location.pathname.includes('/evo/login');
          // Check for a common logout link element
          const logoutButton = document.querySelector('a[href*="CMD_LOGOUT"]');
          // Check for a user menu or welcome message (adjust selector as needed)
          const userElement = document.querySelector('#user_menu') || document.querySelector('.user-info'); // Example selectors

          return !isOnLoginPage && (logoutButton !== null || userElement !== null);
      });

      // Alternative simpler check: just look for the logout button after a small delay
      // await delayTime(2000); // Wait a bit for dashboard elements to load
      // const logoutLink = await page.$('a[href*="CMD_LOGOUT"]');
      // const isLoggedIn = logoutLink !== null;


      if (isLoggedIn) {
        const nowUtc = formatToISO(new Date(new Date().toUTCString())); // Get current UTC time correctly
        const nowBeijing = formatToISO(new Date(Date.now() + 8 * 60 * 60 * 1000)); // Calculate Beijing time
        console.log(`SUCCESS: Account ${username} logged in successfully at Beijing Time: ${nowBeijing} (UTC: ${nowUtc})`);
      } else {
        // Try to get more info if login failed
        const pageContent = await page.content();
        const errorMsg = await page.evaluate(() => {
            const errorElement = document.querySelector('.error-message') || document.querySelector('.alert-danger') || document.querySelector('#login_error_message'); // Common error selectors
            return errorElement ? errorElement.textContent.trim() : 'No specific error message found on page.';
        });
         console.error(`FAILURE: Account ${username} login failed. URL after attempt: ${page.url()}. Possible Error: ${errorMsg}`);
         // Optional: Save screenshot on failure
         // await page.screenshot({ path: `failure_${username}_${Date.now()}.png` });
      }

    } catch (error) {
      console.error(`ERROR during login process for account ${username}: ${error}`);
       if (page) {
           try {
               // Try to take screenshot on error
               // await page.screenshot({ path: `error_${username}_${Date.now()}.png` });
               console.error(`Current page URL on error: ${page.url()}`);
           } catch (screenshotError) {
               console.error(`Could not take screenshot or get URL on error: ${screenshotError}`);
           }
       }
    } finally {
      // Close the page and browser gracefully
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error(`Error closing page for ${username}: ${e.message}`);
        }
      }
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          console.error(`Error closing browser for ${username}: ${e.message}`);
        }
      }

      // Add random delay between processing different accounts
      const delay = Math.floor(Math.random() * 7000) + 1000; // Random delay 1 to 8 seconds
      console.log(`Waiting for ${delay / 1000} seconds before next account...`);
      await delayTime(delay);
    }
  }

  console.log('All accounts processed.');
})();
