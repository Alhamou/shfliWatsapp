const express = require("express");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const port = 3003;

app.use(express.json());

// Create a WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: '/snap/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disk-cache-size=50000000',
      '--aggressive-cache-discard',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  }
});

// Display QR Code when needed
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

// When the client is ready
client.on("ready", () => {
  console.log("Client is ready!");
});

// When authentication is successful
client.on("authenticated", () => {
  console.log("Authenticated successfully!");
});

// When authentication fails
client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
});

// When the client is disconnected
client.on("disconnected", (reason) => {
  console.log("Disconnected:", reason);
});

// Initialize the client
client.initialize();

// API endpoint to send WhatsApp messages
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

    // Check if number is registered on WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      return res.status(400).json({
        error: "Number is not registered on WhatsApp."
      });
    }

    // Send the message
    await client.sendMessage(chatId, block_message);
    return res.status(201).json({
      message: "Message sent successfully!",
      to: phone_number
    });

  } catch (err) {
    console.error("Failed to send message:", err);
    return res.status(500).json({
      error: "Failed to send message.",
      details: err.message
    });
  }
});

// Check connection status
app.get('/status', (req, res) => {
  const status = {
    ready: !!client.info,
    info: client.info || null,
    timestamp: Date.now()
  };

  res.status(200).json(status);
});

// Restart the WhatsApp client
app.post('/restart', async (req, res) => {
  try {
    await client.destroy();
    await client.initialize();
    res.json({ message: 'Client restarted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart client' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    memory: process.memoryUsage(),
    client_status: client.info ? 'connected' : 'disconnected'
  };

  res.status(200).json(health);
});

// Get all groups
// API endpoint to get a list of all groups
app.get("/groups", async (req, res) => {
  // Check if a client is ready
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
  console.log(`Server is running on http://localhost:${port}`);
});

// Graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('Shutting down application...');
  await client.destroy();
  process.exit(0);
});

// Graceful shutdown on SIGTERM (PM2 or system)
process.on('SIGTERM', async () => {
  console.log('Terminating application...');
  await client.destroy();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await client.destroy();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  await client.destroy();
  process.exit(1);
});