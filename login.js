const fs = require('fs');
const puppeteer = require('puppeteer');

// Helper function to format date to a readable ISO-like string (YYYY-MM-DD HH:MM:SS)
function formatReadableDateTime(date) {
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

// Helper function for delay
async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser = null; // Initialize browser variable outside the loop

  try {
    // Read accounts from accounts.json
    const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
    const accounts = JSON.parse(accountsJson);
    console.log(`读取到 ${accounts.length} 个账号信息。`);

    // Launch the browser once before the loop
    // Use 'new' for the modern headless mode, false for visible browser (debugging)
    browser = await puppeteer.launch({ headless: 'new' }); 
    console.log('浏览器已启动...');

    for (const account of accounts) {
      // Use panelnum from the account object
      const { username, password, panelnum } = account; 
      let page = null; // Initialize page variable inside the loop for isolation

      // Construct the URL dynamically for webhostmost
      const url = `https://server${panelnum}.webhostmost.com:2222/evo/login`;

      try {
        // Open a new page for each account attempt
        page = await browser.newPage();
        console.log(`\n[账号: ${username} | 服务器: server${panelnum}] 开始处理...`);
        console.log(`导航到: ${url}`);

        // Navigate to the login page
        // waitUntil: 'networkidle0' waits until there are no network connections for 500ms
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 }); 

        // --- Interact with the webhostmost login form ---

        // Selector for username input (adjust if needed based on inspection)
        const usernameSelector = 'input[name="username"]';
        // Selector for password input (adjust if needed based on inspection)
        const passwordSelector = 'input[name="password"]';
        // Selector for the login button (adjust if needed)
        const loginButtonSelector = 'button[type="submit"]'; 

        // Wait for the username field to be ready before interacting
        await page.waitForSelector(usernameSelector, { visible: true });

        // Clear username field (optional but safer) and type username
        const usernameInput = await page.$(usernameSelector);
        if (usernameInput) {
           // Using evaluate to clear is sometimes more reliable than click/backspace
           await page.evaluate(selector => { document.querySelector(selector).value = ''; }, usernameSelector);
           await page.type(usernameSelector, username);
           console.log(`输入用户名: ${username}`);
        } else {
            throw new Error(`无法找到用户名输入框 (${usernameSelector})`);
        }
        
        // Type password
        await page.type(passwordSelector, password);
        console.log('输入密码。');


        // Click the login button and wait for navigation/response
        console.log('点击登录按钮...');
        const loginButton = await page.$(loginButtonSelector);
        if (loginButton) {
            // Use Promise.all to click and wait for navigation simultaneously
            // If login is AJAX based and doesn't navigate, waitForNavigation might timeout.
            // The catch block prevents the script from crashing if timeout occurs.
            // We rely on the cookie check afterwards regardless.
            await Promise.all([
                loginButton.click(),
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }) // Adjust timeout if needed
                    .catch(e => console.log(`导航等待超时或无导航事件 (可能为AJAX登录)，将继续检查Cookie... Error: ${e.message}`))
            ]);
        } else {
            throw new Error(`无法找到登录按钮 (${loginButtonSelector})`);
        }
        
        // Add a small delay to ensure cookies are set and page state settles
        await delayTime(2500); 

        // --- Login Verification: Check for 'session' cookie ---
        console.log('检查登录状态 (寻找 "session" Cookie)...');
        const cookies = await page.cookies();
        const sessionCookie = cookies.find(cookie => cookie.name === 'session');

        // Get current times for logging
        const nowUtc = formatReadableDateTime(new Date()); // UTC time
        const nowBeijing = formatReadableDateTime(new Date(Date.now() + 8 * 60 * 60 * 1000)); // Beijing time

        if (sessionCookie) {
            console.log(`✅ [账号: ${username}] 登录成功！(检测到 "session" Cookie)`);
            console.log(`   北京时间: ${nowBeijing}`);
            console.log(`   UTC 时间: ${nowUtc}`);
        } else {
            console.error(`❌ [账号: ${username}] 登录失败。未找到 "session" Cookie。`);
             // Optional: Try to find an error message on the page
             try {
                const errorElement = await page.$('.alert.alert-danger'); // Common selector for errors in Bootstrap-like frameworks
                if (errorElement) {
                    const errorMessage = await page.evaluate(el => el.innerText.trim(), errorElement);
                    console.error(`   页面提示信息: ${errorMessage}`);
                } else {
                    console.error(`   未在页面上检测到明确的错误消息。`);
                }
             } catch (evalError) {
                console.error(`   检查页面错误信息时出错: ${evalError.message}`);
             }
             // Optional: Save screenshot on failure for debugging
             const screenshotPath = `failure_${username}_${panelnum}_${Date.now()}.png`;
             await page.screenshot({ path: screenshotPath });
             console.log(`   登录失败截图已保存: ${screenshotPath}`);
        }

      } catch (error) {
        const nowUtc = formatReadableDateTime(new Date()); // UTC time
        const nowBeijing = formatReadableDateTime(new Date(Date.now() + 8 * 60 * 60 * 1000)); // Beijing time
        console.error(`❌ [账号: ${username} | 服务器: server${panelnum}] 处理时发生错误: ${error.message}`);
        console.error(`   发生时间 (北京): ${nowBeijing}`);
        console.error(`   发生时间 (UTC): ${nowUtc}`);
         // Optional: Save screenshot on unexpected errors
         if (page) {
            try {
                const errorScreenshotPath = `error_${username}_${panelnum}_${Date.now()}.png`;
                await page.screenshot({ path: errorScreenshotPath });
                console.log(`   错误截图已保存: ${errorScreenshotPath}`);
            } catch(ssError) {
                console.error(`   无法保存错误截图: ${ssError.message}`);
            }
         }
      } finally {
        // Close the page after processing the current account
        if (page) {
          await page.close();
          console.log(`[账号: ${username}] 页面已关闭。`);
        }

        // Add random delay between accounts to avoid overwhelming the server
        const delay = Math.floor(Math.random() * 7000) + 1000; // Random delay 1s to 8s
        console.log(`--- 暂停 ${delay / 1000} 秒后处理下一个账号 ---`);
        await delayTime(delay);
      }
    } // End of for...of loop

    console.log('\n✅ 所有账号处理完成！');

  } catch (error) {
    // Catch errors occurring outside the account loop (e.g., reading file, launching browser)
    console.error(`脚本执行过程中发生严重错误: ${error}`);
  } finally {
    // Close the browser instance after all accounts are processed or if an error occurred
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭。');
    }
  }
})();
