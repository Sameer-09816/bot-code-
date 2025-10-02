// --- Configuration ---
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

const TELEGRAM_BOT_TOKEN = "8290427504:AAE5ACm2Kfc2aez3mDiq0IZCBCgpmpKiL68";

// This check is crucial for Vercel
if (!TELEGRAM_BOT_TOKEN) {
    console.error("!!! BOT TOKEN NOT FOUND !!! Please set it in Vercel Environment Variables.");
    process.exit(1);
}

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

log('info', 'Bot is initializing in serverless environment...');

// Initialize the bot. Polling is false since we are using a webhook.
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// --- Bot Command and Message Handlers (NO CHANGES HERE) ---
// Your existing bot logic is perfect and does not need to change.
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

// --- Core Logic (Unchanged) ---
async function processSingleLink(chatId, url) {
    try {
        const apiResponse = await apiClient.get(`${INSTAGRAM_API_URL}${url}`);
        const data = apiResponse.data;

        if (data.status !== "ok" || !data.media || data.media.length === 0) {
            const reason = data.message || "Invalid link, private account, or no media found.";
            log('warn', `API failed for ${url}: ${reason}`);
            return { status: 'failure', url, reason };
        }

        const mediaToUpload = [];

        for (const item of data.media) {
            if (!item.media_url) continue;

            try {
                const headResponse = await axios.head(item.media_url, { timeout: 15000 });
                const fileSize = parseInt(headResponse.headers['content-length'] || '0', 10);

                if (fileSize > MAX_FILE_SIZE) {
                    log('warn', `Skipping oversized file for ${url}: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
                    await bot.sendMessage(chatId, `⚠️ Skipped one media from the link below because it's too large (${(fileSize / 1024 / 1024).toFixed(2)} MB).\n<code>${url}</code>`, { parse_mode: 'HTML' });
                    continue;
                }

                mediaToUpload.push({
                    type: item.type === 'video' ? 'video' : 'photo',
                    url: item.media_url,
                });
            } catch (headError) {
                log('error', `Could not fetch media headers for ${item.media_url}: ${headError.message}`);
                return { status: 'failure', url, reason: `Could not download media from post.` };
            }
        }

        if (mediaToUpload.length === 0) {
            return { status: 'failure', url, reason: "All media was too large or could not be accessed." };
        }

        const mediaStreams = mediaToUpload.map(item => ({
            type: item.type,
            media: axios.get(item.url, { responseType: 'stream' }).then(response => response.data),
        }));

        if (mediaStreams.length > 1) {
            const mediaGroup = await Promise.all(mediaStreams.map(async (item) => ({
                type: item.type,
                media: await item.media,
            })));
            await bot.sendMediaGroup(chatId, mediaGroup);
        } else if (mediaStreams.length === 1) {
            const item = mediaStreams[0];
            const stream = await item.media;
            const fileOptions = {
                filename: item.type === 'photo' ? 'instagram.jpg' : 'instagram.mp4',
                contentType: item.type === 'photo' ? 'image/jpeg' : 'video/mp4',
            };

            if (item.type === 'photo') {
                await bot.sendPhoto(chatId, stream, {}, fileOptions);
            } else if (item.type === 'video') {
                await bot.sendVideo(chatId, stream, {}, fileOptions);
            }
        }

        return { status: 'success', url };

    } catch (error) {
        log('error', `Critical error processing ${url}: ${error.message}`);
        const reason = error.code === 'ECONNABORTED' ? 'The request timed out after multiple retries.' : 'A network error occurred.';
        return { status: 'failure', url, reason };
    }
}

// --- Message Handlers (Unchanged) ---
bot.onText(/https?:\/\/(?:www\.)?instagram\.com/, async (msg) => {
    if (msg.text.startsWith('/') || msg.from.is_bot) return;

    const url = msg.text.trim();
    const chatId = msg.chat.id;

    await bot.sendChatAction(chatId, 'typing');
    const processingMessage = await bot.sendMessage(chatId, "⏳ Processing your link, please wait...");

    const result = await processSingleLink(chatId, url);

    try {
        if (result.status === 'success') {
            await bot.deleteMessage(chatId, processingMessage.message_id);
        } else {
            await bot.editMessageText(`❌ Failed to process the link below.\n<b>Reason:</b> ${result.reason}\n\n<code>${result.url}</code>`, {
                chat_id: chatId,
                message_id: processingMessage.message_id,
                parse_mode: 'HTML'
            });
        }
    } catch (e) {
        log('warn', `Could not edit/delete processing message: ${e.message}`);
    }
});

bot.on('document', async (msg) => {
    // ... (Your document handling code is fine, no changes needed)
    const chatId = msg.chat.id;
    const doc = msg.document;

    if (doc.mime_type !== 'text/plain' && !doc.file_name.endsWith('.txt')) {
        return;
    }

    let statusMessage;
    try {
        statusMessage = await bot.sendMessage(chatId, "📄 File received! Parsing links...");
        const fileLink = await bot.getFileLink(doc.file_id);
        const response = await axios.get(fileLink, { responseType: 'text' });
        const fileContent = response.data;
        const regex = /https?:\/\/(?:www\.)?instagram\.com[^\s,]+/g;
        const links = [...new Set(fileContent.match(regex) || [])];

        if (links.length === 0) {
            await bot.editMessageText("❌ No valid Instagram links found in the file.", { chat_id: chatId, message_id: statusMessage.message_id });
            return;
        }

        const totalLinks = links.length;
        log('info', `Starting batch processing for ${totalLinks} links for chat ${chatId}`);
        let processedCount = 0;
        const results = [];
        for (let i = 0; i < totalLinks; i += CONCURRENCY_LIMIT) {
            const chunk = links.slice(i, i + CONCURRENCY_LIMIT);
            await bot.editMessageText(`⏳ Processing batch... (${processedCount}/${totalLinks} complete)`, { chat_id: chatId, message_id: statusMessage.message_id });
            const promises = chunk.map(link => processSingleLink(chatId, link));
            const chunkResults = await Promise.allSettled(promises);
            results.push(...chunkResults);
            processedCount += chunk.length;
        }
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success');
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failure'));
        let summary = `✨ <b>Batch Processing Complete!</b> ✨\n\n✅ <b>Successful:</b> ${successful.length}\n❌ <b>Failed:</b> ${failed.length}\n\n`;
        if (failed.length > 0) {
            summary += `<b>Failed Links:</b>\n`;
            failed.forEach(res => {
                const url = res.value?.url || "Unknown URL";
                const reason = res.value?.reason || res.reason?.message || "Processing error";
                summary += `• <code>${url}</code> - <i>${reason}</i>\n`;
            });
        }
        await bot.editMessageText(summary, { chat_id: chatId, message_id: statusMessage.message_id, parse_mode: 'HTML', disable_web_page_preview: true });

    } catch (error) {
        log('error', `Failed to process text file: ${error.message}`);
        if (statusMessage) {
            await bot.editMessageText("❌ An unexpected error occurred while processing the file.", { chat_id: chatId, message_id: statusMessage.message_id });
        }
    }
});


// --- Vercel Serverless Function Handler ---
// This is the new, crucial part.
module.exports = async (request, response) => {
    try {
        // We are only interested in POST requests from Telegram
        if (request.method !== 'POST') {
            return response.status(200).send('Bot is running...');
        }
        
        // This passes the update to the bot instance
        await bot.processUpdate(request.body);
        
        // Send a 200 OK response to Telegram to acknowledge receipt of the update
        // This MUST be done, otherwise Telegram will keep resending the update.
        response.status(200).send('Update processed');
        
    } catch (error) {
        log('error', `Error in webhook handler: ${error.message}`);
        // If something goes wrong, send a 500 error
        response.status(500).send('Internal Server Error');
    }
};
