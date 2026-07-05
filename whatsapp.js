const fs = require('fs');
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const router = express.Router();
let whatsappClient = null;
let dbRef = null;

const initWhatsApp = (db) => {
    dbRef = db;
    
    let localBrowser = null;
    if (process.platform === 'win32') {
        const browserPaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ];
        localBrowser = browserPaths.find(p => fs.existsSync(p));
    } else if (process.platform === 'darwin') {
        const macPaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
        localBrowser = macPaths.find(p => fs.existsSync(p)) || null;
    }

    whatsappClient = new Client({ 
        authStrategy: new LocalAuth(), 
        puppeteer: { 
            headless: false, // Keeping it visible so you can watch it work!
            executablePath: localBrowser, 
            args: [
                '--new-window',
                '--window-size=1024,768', 
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'
            ] 
        } 
    });

    whatsappClient.on('qr', (qr) => {
        console.log('\n=========================================');
        console.log('📱 WHATSAPP ACTION REQUIRED:');
        console.log('Please scan this QR code to connect your engine:');
        qrcode.generate(qr, { small: true }); 
        console.log('=========================================\n');
    });

    whatsappClient.on('ready', () => {
        console.log('✅ Free WhatsApp Client Ready and Connected!');
    });

    if (localBrowser) {
        console.log("🚀 Starting WhatsApp Engine using:", localBrowser);
        whatsappClient.initialize().catch(err => console.error("WhatsApp Init Error:", err));
    }
};

router.post('/send', async (req, res) => {
    const { phone, message, pdfBase64 } = req.body;
    const settingsDB = await dbRef.settings.findOne({ _id: 'global' }) || { globalPrefs: {} };
    const method = settingsDB.globalPrefs.whatsappMethod || 'free'; 
    
    try {
        if (method === 'free') {
            // 🚀 SMART FORMATTING: Auto-add '91' for 10-digit Indian numbers
            let cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
            const formattedPhone = `${cleanPhone}@c.us`; 
            
            if (!whatsappClient || !whatsappClient.info) {
                return res.status(400).json({ error: "WhatsApp is not linked yet." });
            }

            console.log(`\n🚀 Attempting to forcefully push message to ${cleanPhone}...`);

            // Removed the strict 'getNumberId' check. We just send it directly to the formatted ID!
            if (pdfBase64) {
                const base64Content = pdfBase64.split(',')[1];
                const media = new MessageMedia('application/pdf', base64Content, `Invoice_${Date.now()}.pdf`);
                await whatsappClient.sendMessage(formattedPhone, media, { caption: message, sendMediaAsDocument: true });
            } else {
                await whatsappClient.sendMessage(formattedPhone, message);
            }

            console.log(`✅ SUCCESS: Message pushed to WhatsApp Web!\n`);
            res.json({ message: "Invoice Sent via WhatsApp!" });
        }
    } catch (err) { 
        console.error("🔥 WHATSAPP ENGINE CRASHED:", err.message);
        res.status(500).json({ error: "WhatsApp failed: " + err.message }); 
    }
});

module.exports = { initWhatsApp, whatsappRouter: router };