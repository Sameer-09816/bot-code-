// --- Configuration ---
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const axiosRetry = require('axios-retry').default;

// MODIFIED: No need for APP_URL or PORT from .env, Vercel handles this.
const TELEGRAM_BOT_TOKEN = "8290427504:AAE5ACm2Kfc2aez3mDiq0IZCBCgpmpKiL68";

const INSTAGRAM_API_URL = "https://igapi.sktoolkit.com/download?url=";
const MAX_FILE_SIZE = 49 * 1024 * 1024; // 49 MB
const CONCURRENCY_LIMIT = 5;

// --- Axios Instance with Retry Logic ---
const apiClient = axios.create({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    timeout: 30000
});
axiosRetry(apiClient, {
    retries: 3,
    retryDelay: (retryCount) => {
        log('warn', `Request failed, attempt #${retryCount}. Retrying in ${retryCount * 2}s...`);
        return retryCount * 2000;
    },
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

// --- Logging Setup ---
const log = (level, message) => {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
};

log('info', 'Bot is initializing...');

if (!TELEGRAM_BOT_TOKEN) {
    log('error', "!!! BOT TOKEN NOT FOUND !!! Please set it in Vercel Environment Variables.");
    process.exit(1);
}

// MODIFIED: We will ONLY use webhook mode on Vercel, so polling is set to false.
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// --- Express App Setup (for Vercel) ---
const app = express();
app.use(express.json());

// ADDED: Health check route for the root
app.get('/', (req, res) => {
    res.send('Instagram Downloader Bot is alive!');
});

// MODIFIED: This is our main webhook endpoint.
const webhookPath = `/webhook/${TELEGRAM_BOT_TOKEN}`;
app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); // Important to send a 200 OK back to Telegram
});


// --- Bot Command and Message Handlers (NO CHANGES NEEDED HERE) ---
// ... (your entire block of bot.onText, bot.on('document'), etc. remains exactly the same) ...
// --- START of unchanged section ---
bot.onText(/\/start/, (msg) => {
    const user = msg.from;
    const welcomeMessage = `
👋 Hello, ${user.first_name}!

I am your supercharged Instagram Downloader Bot.

To get started:
➡️ Send me a link to an Instagram Post, Reel, or Story.
➡️ <b>OR</b>, upload a <code>.txt</code> file with multiple links to download them all at once!
    `;
    bot.sendMessage(msg.chat.id, welcomeMessage, { parse_mode: 'HTML' });
});

bot.onText(/\/help/, (msg) => {
    const helpText = `
<b>How to use me:</b>

<b>For a single link:</b>
1. Find a post, reel, or story on Instagram.
2. Copy the link.
3. Paste the link here and send it to me.

<b>For multiple links:</b>
1. Create a <code>.txt</code> file.
2. Add all the Instagram links to the file. You can separate them with new lines, spaces, or commas.
3. Send the <code>.txt</code> file to me as a document.

I will process the links concurrently and send you the media from each one!
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
});

// --- Core Logic ---
async function processSingleLink(chatId, url) {
    // ... (This function remains exactly the same)
}

// --- Message Handlers ---
bot.onText(/https?:\/\/(?:www\.)?instagram\.com/, async (msg) => {
    // ... (This function remains exactly the same)
});

bot.on('document', async (msg) => {
    // ... (This function remains exactly the same)
});

// --- Generic Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
    log('error', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
process.on('uncaughtException', (err, origin) => {
    log('error', `Caught exception: ${err}\nException origin: ${origin}`);
});
// --- END of unchanged section ---


// REMOVED: The entire block that conditionally set up polling vs webhook is gone.
// REMOVED: The app.listen() call is gone. Vercel handles this.

// ADDED: This is the most important part for Vercel.
// We export the Express app instance for Vercel's build process.
module.exports = app;

log('info', 'Bot initialization complete. Ready for Vercel.');

// --- Your processSingleLink function and other handlers go here, unchanged ---
// Just make sure you copy them back into the "unchanged section" above.
