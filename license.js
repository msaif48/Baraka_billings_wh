const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); 
const CACHE_FILE = path.join(__dirname, 'license.cache');

// ==========================================
// AES-256 ENCRYPTION SECURITY
// ==========================================
const ENCRYPTION_KEY_ENV = process.env.ENCRYPTION_KEY || 'DEFAULT_KEY_32_CHARACTERS_CHANGE_ME!';
if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠️ ENCRYPTION_KEY not set in .env. Using default key. Set this in production!');
}
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_ENV.padEnd(32, '0').slice(0, 32), 'utf-8');
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null; // Tamper protection
    }
}

// ==========================================
// LOCAL CACHE STATE
// ==========================================
let cachedLicenseStatus = { 
    expired: true, 
    validUntil: "2020-01-01T00:00:00.000Z",
    licenseKey: null,
    client: "Unregistered",
    clientId: null,
    planType: 'trial',
    maxUsers: 1,
    lastCheckedOnline: new Date().toISOString()
};

if (fs.existsSync(CACHE_FILE)) {
    try { 
        const rawData = fs.readFileSync(CACHE_FILE, 'utf8');
        const decryptedData = decrypt(rawData);
        if (decryptedData) cachedLicenseStatus = JSON.parse(decryptedData);
    } catch(e) {}
}

const saveCache = () => {
    const encryptedData = encrypt(JSON.stringify(cachedLicenseStatus));
    fs.writeFileSync(CACHE_FILE, encryptedData);
};

// ==========================================
// 🔴 THE KILL SWITCH HEARTBEAT
// ==========================================
const checkCloudStatus = async () => {
    if (!cachedLicenseStatus.licenseKey || cachedLicenseStatus.expired) return;

    try {
        const response = await fetch("https://baraka-master-server.vercel.app/api/verify-license", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: cachedLicenseStatus.licenseKey })
        });

        if (!response.ok) {
            cachedLicenseStatus.expired = true;
            saveCache();
        } else {
            const data = await response.json();
            cachedLicenseStatus.validUntil = data.validUntil;
            cachedLicenseStatus.expired = false;
            cachedLicenseStatus.planType = data.planType || 'basic';
            cachedLicenseStatus.maxUsers = data.maxUsers || 1;
            cachedLicenseStatus.clientId = data.clientId;
            cachedLicenseStatus.lastCheckedOnline = new Date().toISOString(); 
            saveCache();
        }
    } catch(e) {}
};

checkCloudStatus();
setInterval(checkCloudStatus, 30000); 

// ==========================================
// 🛡️ MIDDLEWARE (BACKEND PROTECTION)
// ==========================================
const enforceLicense = (req, res, next) => {
    if (req.path === '/check-license' || req.path === '/auth/login' || req.path === '/activate-license' || req.path === '/auth/reset-admin' || req.path === '/settings') {
        return next();
    }
    
    const now = new Date();
    const expiry = new Date(cachedLicenseStatus.validUntil);
    const lastChecked = new Date(cachedLicenseStatus.lastCheckedOnline);
    const daysOffline = (now - lastChecked) / (1000 * 60 * 60 * 24);

    if (cachedLicenseStatus.expired || now > expiry) {
        return res.status(402).json({ error: "LICENSE_EXPIRED" });
    }

    if (daysOffline > 7) {
        return res.status(402).json({ error: "OFFLINE_TIMEOUT", message: "Please connect to the internet to verify your license." });
    }

    next(); 
};

// ==========================================
// 🌐 FRONTEND COMMUNICATION & PROXY
// ==========================================
router.get('/check-license', (req, res) => {
    const now = new Date();
    const lastChecked = new Date(cachedLicenseStatus.lastCheckedOnline);
    const daysOffline = (now - lastChecked) / (1000 * 60 * 60 * 24);
    
    let isExpired = cachedLicenseStatus.expired;
    if (daysOffline > 7) isExpired = true; 
    
    res.json({ ...cachedLicenseStatus, expired: isExpired });
});

router.post('/activate-license', async (req, res) => {
    const { key, action } = req.body;
    if (!key) return res.status(400).json({ error: "Key is required" });

    try {
        const response = await fetch("https://baraka-master-server.vercel.app/api/activate-license", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, action: action || 'activate' })
        });

        const data = await response.json();

        if (!response.ok || !data.valid) {
            return res.status(403).json({ error: data.error || "Activation failed." });
        }
        
        cachedLicenseStatus = {
            expired: false,
            validUntil: data.validUntil,
            licenseKey: key,
            client: data.client,
            clientId: data.clientId,
            planType: data.planType,
            maxUsers: data.maxUsers,
            lastCheckedOnline: new Date().toISOString()
        };
        saveCache();
        
        res.json({ valid: true, validUntil: data.validUntil, planType: data.planType, message: "License Activated Successfully!", data: cachedLicenseStatus });

    } catch(err) {
        res.status(500).json({ error: "Could not reach Master Server. Check shop internet connection." });
    }
});

// ==========================================
// UTILITY EXPORTS
// ==========================================
function getValidLicenseKey() {
    if (!cachedLicenseStatus.expired && cachedLicenseStatus.licenseKey) {
        return cachedLicenseStatus.licenseKey;
    }
    return null;
}

function getLicenseStatus() {
    return cachedLicenseStatus;
}

module.exports = { enforceLicense, licenseRoutes: router, getValidLicenseKey, getLicenseStatus };