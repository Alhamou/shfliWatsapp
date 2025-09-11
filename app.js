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
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
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

app.post ("/send_message", async (req, res) => {
  const { phone_number, block_message } = req.body;

  // Check if phone_number and message are provided
  if (!phone_number || !block_message) {
    return res.status(400).send("Phone phone_number and message are required.");
  }

  // Ensure the client is ready
  if (!client.info) {
    return res.status(503).json({ error: "WhatsApp client is not ready yet." });
  }

  console.log(phone_number, block_message)

  try {
    const chatId = phone_number.substring(1) + "@c.us";

    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      res.status(400).json({ error: "Number is not registered on WhatsApp." });
      return
    }

    await client.sendMessage(chatId, block_message);
    return res.status(201).json({ message: "Message sent successfully!" });


  } catch (err) {
    console.error("Failed to send message:", err);
    return res.status(500).json({ error: "Failed to send message." });
  }

})
// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});



process.on('SIGINT', async () => {
  console.log('إغلاق التطبيق...');
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('إنهاء التطبيق...');
  await client.destroy();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('خطأ غير متوقع:', error);
  await client.destroy();
  process.exit(1);
});