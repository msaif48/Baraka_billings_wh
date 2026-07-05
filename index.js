const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_SECRET = process.env.ADMIN_SECRET;


const readDB = async () => {
    try {
        const res = await fetch(`${process.env.KV_REST_API_URL}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["GET", "licenses"])
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.result ? JSON.parse(data.result) : [];
    } catch (e) { return []; }
};

const saveDB = async (data) => {
    const res = await fetch(`${process.env.KV_REST_API_URL}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["SET", "licenses", JSON.stringify(data)]) 
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
};

// ==========================================
// 1. POS ROUTE: Activate License (with Usage Limits!)
// ==========================================
app.post('/api/activate-license', async (req, res) => {
    const { key, action } = req.body; // Action can be 'activate' or 'verify'
    
    const clients = await readDB();
    const licenseIndex = clients.findIndex(c => c.key === key);

    if (licenseIndex === -1) return res.status(404).json({ error: "Invalid License Key." });
    
    const license = clients[licenseIndex];
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    // Ensure backwards compatibility for older keys that don't have these fields
    license.maxUses = license.maxUses || 1; 
    license.useCount = license.useCount || 0;

    // If the POS is explicitly asking to ACTIVATE (consume a use)
    if (action === 'activate') {
        if (license.useCount >= license.maxUses) {
            return res.status(403).json({ error: "This License Key has reached its maximum activation limit." });
        }
        // Consume a use and save it back to the database
        clients[licenseIndex].useCount += 1;
        await saveDB(clients);
    }

    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// 2. POS ROUTE: Verify License (The 15s Heartbeat)
// ==========================================
app.post('/api/verify-license', async (req, res) => {
    const { licenseKey } = req.body;
    const clients = await readDB();
    const license = clients.find(c => c.key === licenseKey);

    if (!license) return res.status(404).json({ error: "Invalid License Key." });
    if (!license.active) return res.status(403).json({ error: "License locked by Admin." });

    // The heartbeat just checks if the key exists and is active. It does NOT consume a use.
    res.json({ valid: true, validUntil: license.validUntil, client: license.client });
});

// ==========================================
// 3. ADMIN ROUTE: Generate Key
// ==========================================
app.post('/admin/generate-key', async (req, res) => {
    const secretProvided = req.body.adminSecret; 
    const { clientName, duration, unit, exactDate, maxUses } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    let expiryDate = new Date();
    if (exactDate) {
        expiryDate = new Date(exactDate);
    } else {
        const amount = parseInt(duration) || 30; 
        if (unit === 'minutes') expiryDate.setMinutes(expiryDate.getMinutes() + amount);
        else if (unit === 'hours') expiryDate.setHours(expiryDate.getHours() + amount);
        else expiryDate.setDate(expiryDate.getDate() + amount);
    }

    const newLicense = {
        key: `BB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        client: clientName || "Unknown Client",
        validUntil: expiryDate.toISOString(),
        active: true,
        maxUses: parseInt(maxUses) || 1, // Default to 1 use if not provided
        useCount: 0 // Starts at 0
    };

    try {
        const clients = await readDB(); 
        clients.push(newLicense); 
        await saveDB(clients); 
        res.json({ message: "Key Generated successfully", data: newLicense });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 4. ADMIN ROUTE: View All Licenses
// ==========================================
app.post('/admin/view-licenses', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        // Send the entire array of licenses back to the admin dashboard
        res.json({ licenses: clients });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... keep your existing revoke, resume, and extend routes exactly as they are below this point ...
app.post('/admin/revoke-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        clients[licenseIndex].active = false; 
        await saveDB(clients); 
        res.json({ message: `Client locked out successfully.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/resume-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        clients[licenseIndex].active = true; 
        await saveDB(clients); 
        res.json({ message: `Client access resumed successfully.`, validUntil: clients[licenseIndex].validUntil });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/extend-key', async (req, res) => {
    const secretProvided = req.body.adminSecret;
    const { licenseKey, duration, unit, exactDate } = req.body;
    if (secretProvided !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });

    try {
        const clients = await readDB();
        const licenseIndex = clients.findIndex(c => c.key === licenseKey);
        if (licenseIndex === -1) return res.status(404).json({ error: "Key not found." });

        let currentExpiry = new Date(clients[licenseIndex].validUntil);
        const now = new Date();
        if (currentExpiry < now) currentExpiry = now;

        if (exactDate) {
            clients[licenseIndex].validUntil = new Date(exactDate).toISOString();
        } else {
            const amount = parseInt(duration) || 0; 
            if (unit === 'minutes') currentExpiry.setMinutes(currentExpiry.getMinutes() + amount);
            else if (unit === 'hours') currentExpiry.setHours(currentExpiry.getHours() + amount);
            else currentExpiry.setDate(currentExpiry.getDate() + amount);
            
            clients[licenseIndex].validUntil = currentExpiry.toISOString();
        }
        
        clients[licenseIndex].active = true; 
        await saveDB(clients); 
        res.json({ message: `License extended successfully.`, newExpiry: clients[licenseIndex].validUntil });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`📡 Baraka Master Server running on port ${PORT}`));