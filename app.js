const express = require("express");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const port = 3003;

app.use(express.json());

// Create a WhatsApp client with improved puppeteer settings
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: '/snap/bin/chromium',
    headless: true,
    timeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--single-process',
      '--disable-gpu',
      '--disable-images',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--max_old_space_size=4096', // Increase memory limit
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--disable-background-networking'
    ]
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  }
});

// Display QR Code when needed
client.on("qr", (qr) => {
  console.log("QR Code generated, scan it with your phone:");
  qrcode.generate(qr, { small: true });
});

// When the client is ready
client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
});

// When authentication is successful
client.on("authenticated", () => {
  console.log("Authentication successful!");
});

// When authentication fails
client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
});

// Enhanced disconnection handler with auto-reconnect
client.on('disconnected', async (reason) => {
  console.log(`Client disconnected at ${new Date().toISOString()}: ${reason}`);
  console.log('Memory usage:', process.memoryUsage());

  if (reason === 'NAVIGATION' || reason === 'WEBSOCKET_CONNECTION_ERROR') {
    console.log("Attempting auto-reconnect...");
    await restartClient();
  }
});

// Error handler for session issues
client.on('error', async (error) => {
  console.error('Client error occurred:', error);

  // Handle session closed errors
  if (error.message.includes('Session closed') ||
      error.message.includes('Protocol error')) {
    console.log("Session error detected, restarting client...");
    await restartClient();
  }
});

// Initialize the client
client.initialize();

let keepAliveInterval;

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");

  // بدء آلية keep-alive كل 30 ثانية
  keepAliveInterval = setInterval(async () => {
    try {
      if (client.info) {
        await client.getState(); // فحص حالة الاتصال
        console.log("Keep-alive check successful");
      }
    } catch (error) {
      console.log("Keep-alive failed, attempting restart:", error.message);
      await restartClient();
    }
  }, 30000);
});

// Function to restart the WhatsApp client
async function restartClient() {
  try {
    console.log("Starting WhatsApp client restart...");

    // إيقاف keep-alive timer
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }

    // تنظيف الجلسة الحالية
    if (client.pupPage && !client.pupPage.isClosed()) {
      await client.pupPage.close();
    }

    if (client.pupBrowser) {
      await client.pupBrowser.close();
    }

    // انتظار أطول قبل إعادة التشغيل
    await new Promise(resolve => setTimeout(resolve, 10000));

    // إعادة تهيئة العميل
    await client.initialize();

    console.log("Client restarted successfully");
    return true;
  } catch (error) {
    console.error("Failed to restart client:", error);
    return false;
  }
}

// Function to wait for client to be ready
async function waitForClientReady(maxWait = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (client.info) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error("Timeout waiting for client to be ready");
}

// Enhanced API endpoint to send WhatsApp messages with session error handling
app.post("/send_message", async (req, res) => {
  const { phone_number, block_message } = req.body;

  // Validate required data
  if (!phone_number || !block_message) {
    return res.status(400).json({
      error: "Phone number and message are required."
    });
  }

  // Check if client is ready
  if (!client.info) {
    return res.status(503).json({
      error: "WhatsApp client is not ready yet."
    });
  }

  console.log(`Sending to: ${phone_number}, Message: ${block_message}`);

  try {
    // Format phone number (remove + if present)
    let formattedNumber = phone_number;
    if (formattedNumber.startsWith('+')) {
      formattedNumber = formattedNumber.substring(1);
    }

    // Create WhatsApp chat ID
    const chatId = formattedNumber + "@c.us";

    // Check if number is registered on WhatsApp with session error handling
    let isRegistered;
    try {
      isRegistered = await client.isRegisteredUser(chatId);
    } catch (sessionError) {
      // Handle session closed errors during registration check
      if (sessionError.message.includes('Session closed') ||
          sessionError.message.includes('Protocol error')) {

        console.log("Puppeteer session closed during registration check, restarting...");

        try {
          // Restart the client
          await client.destroy();
          await new Promise(resolve => setTimeout(resolve, 3000));
          await client.initialize();

          // Wait for client to be ready
          await waitForClientReady();

          // Retry registration check
          isRegistered = await client.isRegisteredUser(chatId);
        } catch (restartError) {
          console.error("Failed to restart client:", restartError);
          return res.status(503).json({
            error: "Failed to reconnect to WhatsApp.",
            details: "Puppeteer session closed and cannot be restarted"
          });
        }
      } else {
        throw sessionError; // Re-throw if not session related
      }
    }

    if (!isRegistered) {
      return res.status(400).json({
        error: "Number is not registered on WhatsApp."
      });
    }

    // Send the message with session error handling
    try {
      await client.sendMessage(chatId, block_message);
    } catch (sendError) {
      // Handle session closed errors during message sending
      if (sendError.message.includes('Session closed') ||
          sendError.message.includes('Protocol error')) {

        console.log("Session closed during message sending, attempting retry...");

        // Restart client and retry
        await client.destroy();
        await new Promise(resolve => setTimeout(resolve, 3000));
        await client.initialize();
        await waitForClientReady();

        // Retry sending message
        await client.sendMessage(chatId, block_message);
      } else {
        throw sendError;
      }
    }

    return res.status(201).json({
      message: "Message sent successfully!",
      to: phone_number
    });

  } catch (err) {
    console.error("Failed to send message:", err);

    // Classify error type for better error handling
    let errorMessage = "Failed to send message.";
    let statusCode = 500;

    if (err.message.includes('Session closed') ||
        err.message.includes('Protocol error')) {
      errorMessage = "WhatsApp session closed. Please try again.";
      statusCode = 503;
    } else if (err.message.includes('not registered')) {
      errorMessage = "Number is not registered on WhatsApp.";
      statusCode = 400;
    } else if (err.message.includes('timeout')) {
      errorMessage = "Connection timeout. Please try again.";
      statusCode = 408;
    }

    return res.status(statusCode).json({
      error: errorMessage,
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced connection status check
app.get('/status', async (req, res) => {
  try {
    const state = await client.getState();
    const status = {
      ready: !!client.info,
      state: state,
      info: client.info || null,
      timestamp: Date.now(),
      memory: process.memoryUsage()
    };

    res.status(200).json(status);
  } catch (error) {
    res.status(503).json({
      ready: false,
      state: 'ERROR',
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Enhanced restart endpoint with better error handling
app.post('/restart', async (req, res) => {
  try {
    console.log("Manual restart requested...");
    const success = await restartClient();

    if (success) {
      res.json({
        message: 'Client restarted successfully',
        timestamp: Date.now()
      });
    } else {
      res.status(500).json({
        error: 'Failed to restart client',
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error("Restart error:", error);
    res.status(500).json({
      error: 'Failed to restart client',
      details: error.message,
      timestamp: Date.now()
    });
  }
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const health = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB'
    },
    client_status: client.info ? 'connected' : 'disconnected'
  };

  res.status(200).json(health);
});

// API endpoint to get list of all groups
app.get("/groups", async (req, res) => {
  // Check if client is ready
  if (!client.info) {
    return res.status(503).json({
      error: "WhatsApp client is not ready yet."
    });
  }

  try {
    // Get all chats and filter only groups
    const chats = await client.getChats();
    const groups = chats
        .filter(chat => chat.isGroup)
        .map(group => ({
          id: group.id._serialized,
          name: group.name,
          participants_count: group.participants.length,
          description: group.description || "",
          created_at: group.createdAt || null
        }));

    return res.status(200).json({
      groups: groups,
      total: groups.length
    });

  } catch (err) {
    console.error("Failed to get groups:", err);
    return res.status(500).json({
      error: "Failed to get groups.",
      details: err.message
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`WhatsApp API Server is running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Status check: http://localhost:${port}/status`);
});

// Enhanced graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('Shutting down application gracefully...');
  try {
    await client.destroy();
    console.log('WhatsApp client destroyed successfully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Enhanced graceful shutdown on SIGTERM (PM2 or system)
process.on('SIGTERM', async () => {
  console.log('Terminating application gracefully...');
  try {
    await client.destroy();
    console.log('WhatsApp client destroyed successfully');
  } catch (error) {
    console.error('Error during termination:', error);
  }
  process.exit(0);
});

// Enhanced uncaught exception handler
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception occurred:', error);
  try {
    await client.destroy();
    console.log('WhatsApp client destroyed after uncaught exception');
  } catch (destroyError) {
    console.error('Error destroying client after uncaught exception:', destroyError);
  }
  process.exit(1);
});

// Enhanced unhandled promise rejection handler
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);

  // Only restart if it's a session-related error
  if (reason && reason.message &&
      (reason.message.includes('Session closed') ||
          reason.message.includes('Protocol error'))) {
    console.log('Session-related unhandled rejection, attempting restart...');
    await restartClient();
  } else {
    try {
      await client.destroy();
      console.log('WhatsApp client destroyed after unhandled rejection');
    } catch (destroyError) {
      console.error('Error destroying client after unhandled rejection:', destroyError);
    }
    process.exit(1);
  }
});
