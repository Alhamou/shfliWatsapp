const express = require('express');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const port = 3003;

// Create a WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth()
});

// Display QR Code when needed
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

// When the client is ready
client.on('ready', () => {
    console.log('Client is ready!');
});

// When authentication is successful
client.on('authenticated', () => {
    console.log('Authenticated successfully!');
});

// When authentication fails
client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
});

// When the client is disconnected
client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
});

// Initialize the client
client.initialize();

// Endpoint to send a message
app.get('/send', async (req, res) => {


    const { number, message } = req.query;



    // Check if number and message are provided
    if (!number || !message) {
        return res.status(400).send('Phone number and message are required.');
    }

    try {

        // we have to delete "+" from the beginning and add "@c.us" at the end of the number.
        const chatId = number.substring(1) + "@c.us";

        client.isRegisteredUser(chatId).then(async function(isRegistered) {

            if(isRegistered) {
                await client.sendMessage(chatId, text)
                return res.status(201).json({message: 'Message sent successfully!'});
            } else {
                return res.status(400).json({error: 'Number has no Whatsapp with: isRegisteredUser NOT'});
            }
        })
    } catch (err) {
        console.error('Failed to send message:', err);
        return res.status(500).json({error: 'Failed to send message.'});

    }


});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
