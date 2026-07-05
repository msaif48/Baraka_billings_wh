require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const open = require('open');
const rateLimit = require('express-rate-limit');
const AWS = require('aws-sdk'); 
require('aws-sdk/lib/maintenance_mode_message').suppress = true; 

const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'})); 
app.use(express.static(__dirname));

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_local_dev_key_123";
const PORT = process.env.PORT || 3000;

// ==========================================
// 🛡️ SECURITY: LOGIN RATE LIMITER
// ==========================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    handler: (req, res) => {
        res.status(429).json({ error: "Too many failed login attempts. System locked for 15 minutes." });
    }
});

// ==========================================
// ☁️ MONGODB ATLAS CLOUD INITIALIZATION
// ==========================================
const { MongoClient } = require('mongodb');

// Grab the cloud URL from Render environment variables
const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/baraka');
let mongoDbInstance = null;

// Connect to Cloud Atlas asynchronously
mongoClient.connect().then(() => {
    mongoDbInstance = mongoClient.db();
    console.log("🔌 Connected successfully to MongoDB Cloud Atlas!");
    initializeIndices();
    initializeAdmin(); 
}).catch(err => console.error("❌ MongoDB Connection Error:", err));

class MongoCursorWrapper {
    constructor(cursor) { this.cursor = cursor; }
    sort(obj) { this.cursor = this.cursor.sort(obj); return this; }
    skip(n) { this.cursor = this.cursor.skip(n); return this; }
    limit(n) { this.cursor = this.cursor.limit(n); return this; }
    then(onFulfilled, onRejected) {
        return this.cursor.toArray().then(onFulfilled, onRejected);
    }
}

class MongoCollectionWrapper {
    constructor(collectionName) { this.name = collectionName; }
    get col() {
        if (!mongoDbInstance) throw new Error("Database connection is initializing...");
        return mongoDbInstance.collection(this.name);
    }
    async findOne(...args) { return await this.col.findOne(...args); }
    find(...args) { return new MongoCursorWrapper(this.col.find(...args)); }
    async insert(doc) {
        if (Array.isArray(doc)) { await this.col.insertMany(doc); return doc; } 
        else { await this.col.insertOne(doc); return doc; }
    }
    async update(query, update, options = {}) {
        const mongoOptions = { upsert: options.upsert || false };
        if (options.multi) {
            const res = await this.col.updateMany(query, update, mongoOptions);
            return res.modifiedCount;
        } else {
            const res = await this.col.updateOne(query, update, mongoOptions);
            return res.modifiedCount;
        }
    }
    async remove(query, options = {}) {
        if (options.multi) {
            const res = await this.col.deleteMany(query);
            return res.deletedCount;
        } else {
            const res = await this.col.deleteOne(query);
            return res.deletedCount;
        }
    }
    async count(query) { return await this.col.countDocuments(query); }
    async ensureIndex(options) {
        const spec = {};
        spec[options.fieldName] = 1;
        return await this.col.createIndex(spec, { unique: options.unique || false });
    }
}

const db = {
    users: new MongoCollectionWrapper('users'),
    inventory: new MongoCollectionWrapper('inventory'),
    invoices: new MongoCollectionWrapper('invoices'),
    customers: new MongoCollectionWrapper('customers'),
    expenses: new MongoCollectionWrapper('expenses'),
    settings: new MongoCollectionWrapper('settings'),
    audit_logs: new MongoCollectionWrapper('audit_logs'),
    login_history: new MongoCollectionWrapper('login_history')
};

function initializeIndices() {
    db.invoices.ensureIndex({ fieldName: 'id', unique: true });
    db.invoices.ensureIndex({ fieldName: 'date' });
    db.invoices.ensureIndex({ fieldName: 'isSynced' }); 
    db.inventory.ensureIndex({ fieldName: 'id', unique: true });
    db.inventory.ensureIndex({ fieldName: 'sku' });
    db.customers.ensureIndex({ fieldName: 'phone', unique: true });
}

// ✅ CENTRALIZED AUDIT LOGGING ENGINE
async function logAudit(username, action, entity, details) {
    try {
        await db.audit_logs.insert({
            timestamp: new Date().toISOString(),
            username: username || 'SYSTEM',
            action: action,
            entity: entity,
            details: details     
        });
    } catch(e) { console.error("Audit Log Failure:", e); }
}

// ==========================================
// 🔗 UNIVERSAL WEBHOOK ENGINE (INTEGRATION LAYER)
// ==========================================
async function dispatchWebhook(eventName, payload) {
    try {
        const settings = await db.settings.findOne({ _id: 'global' });
        if (!settings || !settings.webhooks || settings.webhooks.length === 0) return;

        const targetHooks = settings.webhooks.filter(w => w.event === eventName || w.event === '*');
        
        for (let hook of targetHooks) {
            fetch(hook.url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'X-POS-Source': 'Baraka-Enterprise-Local' 
                },
                body: JSON.stringify({ 
                    event: eventName, 
                    timestamp: new Date().toISOString(), 
                    data: payload 
                })
            }).catch(err => console.error(`⚠️ Webhook Failed [${hook.url}]:`, err.message));
        }
    } catch (e) {
        console.error("Webhook System Error:", e);
    }
}

// FAILSAFE: Ensure admin exists on startup
async function initializeAdmin() {
    const adminExists = await db.users.findOne({ username: 'admin' });
    if (!adminExists) {
        const hash = await bcrypt.hash("admin123", 10);
        await db.users.insert({ 
            username: "admin", 
            passwordHash: hash, 
            role: "admin", 
            perms: ["dash", "inv", "bill", "sales", "reports", "set_profile", "set_columns", "set_prefs", "set_users"] 
        });
        await logAudit('SYSTEM', 'CREATE', 'USER', 'Default admin user created.');
        console.log("🛠️ Default admin user created.");
    }
}

// ==========================================
// SECURE CLOUD LICENSE CHECK 
// ==========================================
const { enforceLicense, licenseRoutes, getValidLicenseKey, getLicenseStatus } = require('./license.js');
app.use('/api', enforceLicense); 
app.use('/api', licenseRoutes);  

// ==========================================
// MIDDLEWARE & AUTH
// ==========================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) return res.status(401).json({ error: "Access Denied." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Session Expired." });
        req.user = user; 
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Admin access required." });
    next();
}

// ✅ UPGRADED: LOGIN HISTORY TRACKING
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const user = await db.users.findOne({ username: username, deleted: { $ne: true } });
    
    if (!user) {
        await db.login_history.insert({ timestamp: new Date().toISOString(), attemptUser: username, status: 'FAILED_USER_NOT_FOUND', ip: req.ip });
        return res.status(401).json({ error: "User not found" });
    }

    const validPass = await bcrypt.compare(password, user.passwordHash);
    if (!validPass) {
        await db.login_history.insert({ timestamp: new Date().toISOString(), attemptUser: username, status: 'FAILED_BAD_PASSWORD', ip: req.ip });
        return res.status(401).json({ error: "Invalid password" });
    }

    await db.login_history.insert({ timestamp: new Date().toISOString(), attemptUser: username, status: 'SUCCESS', ip: req.ip });
    await logAudit(username, 'LOGIN', 'AUTH', 'User logged in securely');

    const token = jwt.sign({ username: user.username, role: user.role, perms: user.perms }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ message: "Login successful", token: token, role: user.role, perms: user.perms });
});

app.post('/api/auth/reset-admin', async (req, res) => {
    const { licenseKey } = req.body;
    const validKey = getValidLicenseKey();

    if (validKey && licenseKey === validKey) {
        const hash = await bcrypt.hash('admin123', 10);
        const updated = await db.users.update(
            { username: 'admin' }, 
            { $set: { passwordHash: hash } }, 
            { multi: false }
        );
        if (updated) {
            await logAudit('SYSTEM', 'UPDATE', 'AUTH', 'Admin password reset via cloud license key.');
            return res.json({ message: "Admin password successfully reset to 'admin123'" });
        }
    }
    await logAudit('SYSTEM', 'FAILED_ACTION', 'AUTH', 'Failed attempt to reset admin password via license key.');
    res.status(403).json({ error: "Invalid License Key. Reset denied." });
});

function validateNumber(val, min = 0) {
    const num = parseFloat(val);
    return !isNaN(num) && num >= min;
}

// ==========================================
// DASHBOARD STATS (WITH ADVANCED ANALYTICS)
// ==========================================
app.get('/api/stats', authenticateToken, async (req, res) => {
    const invoices = await db.invoices.find({});
    const expenses = await db.expenses.find({ deleted: { $ne: true } });
    const inventory = await db.inventory.find({ deleted: { $ne: true } });

    let totalSales = 0; 
    let grossProfit = 0; 
    let totalTaxCollected = 0;
    
    let cashierStats = {}; 
    let productStats = {};

    invoices.forEach(inv => {
        totalSales += (inv.grandTotal || 0);
        grossProfit += (inv.totalProfit || 0);
        totalTaxCollected += (inv.taxAmount || 0);

        const cashier = inv.cashier || 'System';
        if (!cashierStats[cashier]) cashierStats[cashier] = 0;
        if (!inv.isSettlement) cashierStats[cashier] += (inv.grandTotal || 0);

        if (inv.items && !inv.isSettlement) {
            inv.items.forEach(item => {
                if (item.id === 'settlement' || item.name.includes('Refund')) return;
                if (!productStats[item.name]) productStats[item.name] = { qty: 0, revenue: 0 };
                productStats[item.name].qty += item.qty;
                productStats[item.name].revenue += item.total;
            });
        }
    });

    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netProfit = grossProfit - totalExpenses;
    
    let lowStockCount = 0;
    inventory.forEach(p => {
        if (p.stock !== null) {
            let totalStock = p.stock;
            if (p.batches && p.batches.length > 0) {
                totalStock = p.batches.reduce((sum, b) => sum + b.qty, 0);
            }
            if (totalStock <= (p.lowStockAlert || 0)) lowStockCount++;
        }
    });

    const topProducts = Object.entries(productStats)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.qty - a.qty).slice(0, 5);

    const topCashiers = Object.entries(cashierStats)
        .map(([name, revenue]) => ({ name, revenue }))
        .sort((a, b) => b.revenue - a.revenue);

    const recentTransactions = invoices
        .filter(inv => inv.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();

    const chartData = { labels: last7Days, data: Array(7).fill(0) };
    invoices.forEach(inv => {
        if (!inv.date || inv.isSettlement) return;
        const dateStr = inv.date.split('T')[0];
        const idx = chartData.labels.indexOf(dateStr);
        if (idx !== -1) {
            chartData.data[idx] += (inv.grandTotal || 0);
        }
    });
    
    res.json({ 
        totalSales, totalProfit: netProfit, totalTax: totalTaxCollected, totalExpenses, 
        totalInvoices: invoices.length, lowStockCount, recentTransactions, chartData,
        topProducts, topCashiers 
    });
});

// ==========================================
// AUDIT LOGS API (ADMIN ONLY)
// ==========================================
app.get('/api/audit-logs', authenticateToken, requireAdmin, async (req, res) => {
    const logs = await db.audit_logs.find({}).sort({ timestamp: -1 }).limit(100);
    res.json(logs);
});

// ==========================================
// EXPENSES API (WITH SOFT DELETE)
// ==========================================
app.get('/api/expenses', authenticateToken, async (req, res) => {
    const expenses = await db.expenses.find({ deleted: { $ne: true } }).sort({ date: -1 });
    res.json(expenses);
});

app.post('/api/expenses', authenticateToken, requireAdmin, async (req, res) => {
    const { category, description, amount } = req.body;
    if (!validateNumber(amount, 0.01)) return res.status(400).json({ error: "Invalid expense amount." });
    
    const newExpense = { 
        id: Date.now(), date: new Date().toISOString(), category, 
        description: description || "", amount: parseFloat(amount), loggedBy: req.user.username 
    };
    await db.expenses.insert(newExpense);
    await logAudit(req.user.username, 'CREATE', 'EXPENSE', `Logged ₹${amount} for ${category}`);
    res.json({ message: "Expense logged successfully!", expense: newExpense });
});

app.delete('/api/expenses/:id', authenticateToken, requireAdmin, async (req, res) => {
    await db.expenses.update({ id: parseInt(req.params.id) }, { $set: { deleted: true, deletedAt: new Date().toISOString(), deletedBy: req.user.username } });
    await logAudit(req.user.username, 'DELETE_SOFT', 'EXPENSE', `Soft deleted expense ID ${req.params.id}`);
    res.json({ message: "Expense removed." });
});

// ==========================================
// CUSTOMER CRM API
// ==========================================
app.get('/api/customers', authenticateToken, async (req, res) => {
    const customers = await db.customers.find({}).sort({ lastVisit: -1 });
    res.json(customers);
});

// ==========================================
// INVENTORY API (WITH SOFT DELETE)
// ==========================================
app.get('/api/inventory', authenticateToken, async (req, res) => {
    const inventory = await db.inventory.find({ deleted: { $ne: true } });
    res.json(inventory);
});

app.post('/api/inventory', authenticateToken, requireAdmin, async (req, res) => {
    const { sku, barcodes, name, category, price, actualCost, taxRate, stock, lowStockAlert, batches } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ error: "Product name is required." });
    if (!validateNumber(price)) return res.status(400).json({ error: "Invalid price." });
    
    const newProduct = {
        id: Date.now(), 
        sku: sku || `SKU-${Date.now().toString().slice(-4)}`, 
        barcodes: barcodes || [],
        name, 
        category: category || "Uncategorized", 
        price: parseFloat(price), 
        actualCost: parseFloat(actualCost) || 0, 
        taxRate: parseFloat(taxRate) || 18,
        stock: stock === "" || stock === null ? null : parseInt(stock), 
        batches: batches || [],
        lowStockAlert: parseInt(lowStockAlert) || 0
    };
    
    const insertedProduct = await db.inventory.insert(newProduct);
    await logAudit(req.user.username, 'CREATE', 'INVENTORY', `Added product: ${name}`);
    
    dispatchWebhook('inventory.created', insertedProduct);
    
    res.json({ message: "Product added!", product: insertedProduct });
});

app.put('/api/inventory/:id', authenticateToken, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const existingProduct = await db.inventory.findOne({ id: id });
    if (!existingProduct) return res.status(404).json({ error: "Product not found" });
    
    const { sku, barcodes, name, category, price, actualCost, taxRate, stock, lowStockAlert, batches } = req.body;

    const updates = {
        sku: sku || existingProduct.sku, 
        barcodes: barcodes || existingProduct.barcodes || [],
        name: name || existingProduct.name, 
        category: category || existingProduct.category, 
        price: validateNumber(price) ? parseFloat(price) : existingProduct.price, 
        actualCost: validateNumber(actualCost) ? parseFloat(actualCost) : (existingProduct.actualCost || 0),
        taxRate: validateNumber(taxRate) ? parseFloat(taxRate) : (existingProduct.taxRate || 18),
        stock: (stock === "" || stock === null) ? null : parseInt(stock), 
        batches: batches || existingProduct.batches || [],
        lowStockAlert: validateNumber(lowStockAlert) ? parseInt(lowStockAlert) : (existingProduct.lowStockAlert || 0)
    };

    await db.inventory.update({ id: id }, { $set: updates }, { multi: false }); 
    await logAudit(req.user.username, 'UPDATE', 'INVENTORY', `Updated product ID: ${id}`);
    res.json({ message: "Product updated safely!" });
});

app.delete('/api/inventory/:id', authenticateToken, requireAdmin, async (req, res) => {
    await db.inventory.update({ id: parseInt(req.params.id) }, { $set: { deleted: true, deletedAt: new Date().toISOString(), deletedBy: req.user.username } });
    await logAudit(req.user.username, 'DELETE_SOFT', 'INVENTORY', `Soft deleted product ID: ${req.params.id}`);
    res.json({ message: "Product deleted!" });
});

app.post('/api/inventory/bulk', authenticateToken, requireAdmin, async (req, res) => {
    const items = req.body; let addedCount = 0;
    const itemsToInsert = [];
    
    items.forEach(item => {
        if (item.name && item.price !== undefined && validateNumber(item.price)) {
            itemsToInsert.push({
                id: Date.now() + Math.floor(Math.random() * 10000), 
                sku: item.sku || `SKU-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 100)}`,
                barcodes: item.sku ? [item.sku] : [],
                name: item.name, category: item.category || "Uncategorized", price: parseFloat(item.price), actualCost: parseFloat(item.actualCost) || 0,
                taxRate: parseFloat(item.taxRate) || 18, stock: item.stock === "" || item.stock === null || isNaN(item.stock) ? null : parseInt(item.stock), 
                batches: [], lowStockAlert: parseInt(item.lowStockAlert) || 0
            });
            addedCount++;
        }
    });
    
    if(itemsToInsert.length > 0) {
        await db.inventory.insert(itemsToInsert);
        await logAudit(req.user.username, 'CREATE', 'INVENTORY', `Bulk imported ${addedCount} products.`);
    }
    res.json({ message: `Successfully imported ${addedCount} items!` });
});

app.get('/api/webhooks', authenticateToken, requireAdmin, async (req, res) => {
    const settings = await db.settings.findOne({ _id: 'global' });
    res.json(settings.webhooks || []);
});

app.post('/api/webhooks', authenticateToken, requireAdmin, async (req, res) => {
    const { event, url } = req.body;
    if (!url || !url.startsWith('http')) return res.status(400).json({ error: "Valid URL required." });
    
    await db.settings.update(
        { _id: 'global' }, 
        { $push: { webhooks: { id: Date.now(), event, url } } },
        { upsert: true }
    );
    await logAudit(req.user.username, 'CREATE', 'WEBHOOK', `Added webhook for ${event} to ${url}`);
    res.json({ message: "Webhook integrated successfully!" });
});

app.delete('/api/webhooks/:id', authenticateToken, requireAdmin, async (req, res) => {
    await db.settings.update(
        { _id: 'global' }, 
        { $pull: { webhooks: { id: parseInt(req.params.id) } } }
    );
    await logAudit(req.user.username, 'DELETE', 'WEBHOOK', `Removed webhook ID: ${req.params.id}`);
    res.json({ message: "Webhook removed." });
});

// ==========================================
// ENTERPRISE INVOICES (FIFO & KHATA FIX)
// ==========================================
app.post('/api/invoices', authenticateToken, async (req, res) => {
    const { customerName, phone, discountVal, discountType, items, payments, taxConfig } = req.body; 
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Cart is empty." });

    const parsedDiscount = parseFloat(discountVal) || 0;
    if (parsedDiscount < 0) return res.status(400).json({ error: "Discount cannot be negative." });

    let subtotal = 0; let totalCostOfGoods = 0; let receiptItems = [];

    for (let item of items) {
        let qty = parseInt(item.qty);
        if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity detected." });

        let actualPrice = parseFloat(item.price); let itemCost = 0;
        if (!validateNumber(actualPrice)) return res.status(400).json({ error: "Invalid price detected." });

        if (item.id !== 'custom') {
            const product = await db.inventory.findOne({ id: parseInt(item.id) }); 
            if (product) { 
                actualPrice = product.price; 
                itemCost = product.actualCost || 0; 

                if (product.stock !== null) {
                    let totalAvailable = product.stock;
                    if (product.batches && product.batches.length) {
                        totalAvailable = product.batches.reduce((sum, b) => sum + b.qty, 0);
                    }
                    if (qty > totalAvailable) {
                        return res.status(400).json({ error: `Insufficient stock for ${product.name}. Available: ${totalAvailable}` });
                    }
                    
                    let remainingToDeduct = qty;
                    let newTotalStock = product.stock - remainingToDeduct;
                    let updatedBatches = product.batches ? [...product.batches] : [];
                    
                    if (updatedBatches.length > 0) {
                        updatedBatches.sort((a, b) => new Date(a.expiry || '2099-01-01') - new Date(b.expiry || '2099-01-01'));
                        for (let batch of updatedBatches) {
                            if (remainingToDeduct <= 0) break;
                            if (batch.qty > 0) {
                                if (batch.qty >= remainingToDeduct) {
                                    batch.qty -= remainingToDeduct;
                                    remainingToDeduct = 0;
                                } else {
                                    remainingToDeduct -= batch.qty;
                                    batch.qty = 0;
                                }
                            }
                        }
                        updatedBatches = updatedBatches.filter(b => b.qty > 0);
                    }
                    await db.inventory.update(
                        { id: product.id },
                        { $set: { stock: newTotalStock, batches: updatedBatches } }
                    );
                    
                    if (newTotalStock <= (product.lowStockAlert || 0)) {
                        dispatchWebhook('alert.low_stock', { 
                            name: product.name, 
                            remainingStock: newTotalStock, 
                            alertThreshold: product.lowStockAlert 
                        });
                    }
                }
            }
        }
        
        const itemDiscount = validateNumber(item.discount) ? parseFloat(item.discount) : 0;
        if(itemDiscount > (actualPrice * qty)) return res.status(400).json({ error: "Item discount exceeds item total." });

        const itemTotal = (actualPrice * qty) - itemDiscount;
        subtotal += itemTotal; totalCostOfGoods += (itemCost * qty); 
        receiptItems.push({ name: item.name, price: actualPrice, qty: qty, discount: itemDiscount, total: itemTotal });
    }

    let discountAmount = discountType === 'percent' ? subtotal * (parsedDiscount / 100) : parsedDiscount;
    if (discountAmount > subtotal) discountAmount = subtotal;

    const postDiscountTotal = subtotal - discountAmount;
    
    let taxAmount = 0;
    let finalGrandTotal = postDiscountTotal;

    if (taxConfig && taxConfig.rate > 0) {
        if (taxConfig.type === 'exclusive') {
            taxAmount = postDiscountTotal * (taxConfig.rate / 100);
            finalGrandTotal = postDiscountTotal + taxAmount;
        } else {
            taxAmount = postDiscountTotal - (postDiscountTotal / (1 + (taxConfig.rate / 100)));
            finalGrandTotal = postDiscountTotal;
        }
    }

    let docPrefix = "INV-";
    if (req.body.isSettlement) {
        docPrefix = (payments && payments.cash < 0) ? "CRN-" : "RCPT-";
    }

    const newInvoice = { 
        id: docPrefix + Date.now().toString().slice(-6), 
        date: new Date().toISOString(), 
        isSettlement: req.body.isSettlement || false, 
        customerName: customerName || "Walk-in", 
        phone: phone || "", 
        cashier: req.user.username, 
        items: receiptItems, 
        subtotal: subtotal, 
        discount: discountAmount, 
        taxName: taxConfig?.name || 'Tax', 
        taxAmount: taxAmount, 
        grandTotal: finalGrandTotal, 
        totalProfit: postDiscountTotal - totalCostOfGoods,
        payments: payments || {}, 
        isSynced: false 
    };
    
    await db.invoices.insert(newInvoice);
    await logAudit(req.user.username, 'CREATE', 'INVOICE', `Generated document: ${newInvoice.id}`);

    dispatchWebhook('invoice.created', newInvoice);

    if (phone && phone.trim() !== '') {
        const cleanPhone = phone.trim();
        const existingCustomer = await db.customers.findOne({ phone: cleanPhone });
        
        const pointsEarned = Math.floor(finalGrandTotal / 100);
        const pointsRedeemed = payments?.loyalty || 0;
        const netPoints = pointsEarned - pointsRedeemed;
        const creditOwed = payments?.creditDue || 0;

        if (existingCustomer) {
            let updates = { 
                $inc: { totalSpent: finalGrandTotal, visits: 1, loyaltyPoints: netPoints, creditDue: creditOwed }, 
                $set: { lastVisit: new Date().toISOString() } 
            };
            if (customerName && customerName !== "Walk-in") updates.$set.name = customerName;
            await db.customers.update({ phone: cleanPhone }, updates);
        } else {
            await db.customers.insert({
                id: Date.now(), 
                name: customerName || "Unknown", 
                phone: cleanPhone,
                totalSpent: finalGrandTotal, 
                visits: 1, 
                loyaltyPoints: Math.max(0, netPoints), 
                creditDue: creditOwed,
                firstVisit: new Date().toISOString(), 
                lastVisit: new Date().toISOString()
            });
        }
    }
    res.json({ message: "Invoice saved securely!", invoice: newInvoice });
});

app.post('/api/invoices/settle', authenticateToken, async (req, res) => {
    const { originalInvoiceId, amount, payMethod, customerName, phone } = req.body;
    const inv = await db.invoices.findOne({ id: originalInvoiceId });
    if (!inv) return res.status(404).json({ error: "Original invoice not found." });

    const isOwed = (inv.payments.creditDue || 0) > 0;
    const parsedAmt = parseFloat(amount);
    
    let currentBalance = inv.payments.creditDue || 0;
    const newCreditDue = isOwed ? (currentBalance - parsedAmt) : (currentBalance + parsedAmt);
    
    const settlementRecord = {
        date: new Date().toISOString(),
        amount: parsedAmt,
        method: payMethod || 'cash',
        type: isOwed ? 'Payment Received' : 'Refund Issued'
    };

    const updatedSettlements = inv.settlements ? [...inv.settlements, settlementRecord] : [settlementRecord];
    
    await db.invoices.update(
        { id: originalInvoiceId },
        { $set: { "payments.creditDue": newCreditDue, settlements: updatedSettlements } }
    );

    const docPrefix = isOwed ? "RCPT-" : "CRN-";
    const newDocId = docPrefix + Date.now().toString().slice(-6);
    
    const receiptInvoice = {
        id: newDocId,
        date: new Date().toISOString(),
        isSettlement: true,
        referenceInvoice: originalInvoiceId,
        customerName: customerName || inv.customerName,
        phone: phone || inv.phone,
        cashier: req.user.username,
        items: [{
            id: 'settlement',
            name: (isOwed ? 'Payment applied to ' : 'Refund given for ') + originalInvoiceId,
            price: 0, qty: 1, discount: 0, total: 0
        }],
        subtotal: 0, discount: 0, taxName: 'Tax', taxAmount: 0, grandTotal: 0, totalProfit: 0,
        payments: {
            cash: payMethod === 'cash' ? (isOwed ? parsedAmt : -parsedAmt) : 0,
            upi: payMethod === 'upi' ? (isOwed ? parsedAmt : -parsedAmt) : 0,
            card: payMethod === 'card' ? (isOwed ? parsedAmt : -parsedAmt) : 0,
            wallet: payMethod === 'wallet' ? (isOwed ? parsedAmt : -parsedAmt) : 0,
            loyalty: 0, creditDue: 0 
        },
        isSynced: false
    };
    await db.invoices.insert(receiptInvoice);
    await logAudit(req.user.username, 'CREATE', 'SETTLEMENT', `Settled ₹${parsedAmt} for ${originalInvoiceId} via ${newDocId}`);

    if (phone || inv.phone) {
        const targetPhone = phone || inv.phone;
        const customer = await db.customers.findOne({ phone: targetPhone });
        if (customer) {
            const custAdjustment = isOwed ? -parsedAmt : parsedAmt;
            await db.customers.update({ phone: targetPhone }, { $inc: { creditDue: custAdjustment } });
        }
    }

    res.json({ message: "Invoice successfully settled!", receiptId: newDocId, newBalance: newCreditDue });
});

app.get('/api/invoices', authenticateToken, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    
    const totalInvoices = await db.invoices.count({});
    const invoices = await db.invoices.find({}).sort({ date: -1 }).skip(startIndex).limit(limit);
    
    res.json({ totalInvoices, totalPages: Math.ceil(totalInvoices / limit), currentPage: page, invoices });
});

// ==========================================
// SETTINGS API
// ==========================================
app.get('/api/settings', authenticateToken, async (req, res) => {
    let settingsDB = await db.settings.findOne({ _id: 'global' });
    
    if (!settingsDB || !settingsDB.pdfColumns || settingsDB.pdfColumns.length === 0) {
        if (!settingsDB) settingsDB = { _id: 'global', businessProfile: {}, globalPrefs: {} };
        settingsDB.pdfColumns = [
            { key: 'item', label: 'Item Name', show: true },
            { key: 'qty', label: 'Qty', show: true },
            { key: 'rate', label: 'Price', show: true },
            { key: 'discount', label: 'Discount', show: false },
            { key: 'amount', label: 'Total', show: true }
        ];
        await db.settings.update({ _id: 'global' }, settingsDB, { upsert: true });
    }
    
    res.json({ ...settingsDB, subscription: { validUntil: "2099-12-31T23:59:59.999Z" } });
});

app.post('/api/settings', authenticateToken, requireAdmin, async (req, res) => {
    await db.settings.update({ _id: 'global' }, { $set: req.body }, { upsert: true });
    await logAudit(req.user.username, 'UPDATE', 'SETTINGS', 'Modified global system settings.');
    res.json({ message: "Settings saved successfully!" });
});

// ==========================================
// USER MANAGEMENT API (WITH SOFT DELETE)
// ==========================================
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const users = await db.users.find({ deleted: { $ne: true } });
    res.json(users.map(u => ({ username: u.username, role: u.role, perms: u.perms })));
});

app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const { username, password, role, perms } = req.body;
    
    const currentUsers = await db.users.count({ deleted: { $ne: true } });
    const license = getLicenseStatus(); 
    const maxAllowed = license.maxUsers || 3; 
    const planType = license.planType || 'basic';

    if (currentUsers >= maxAllowed) {
        return res.status(403).json({ error: `Your ${planType} plan is limited to ${maxAllowed} users. Please upgrade to Pro.` });
    }

    const existing = await db.users.findOne({ username });
    if (existing) return res.status(400).json({ error: "Username already exists." });
    
    const hash = await bcrypt.hash(password, 10);
    await db.users.insert({ username, passwordHash: hash, role, perms: perms || [] });
    await logAudit(req.user.username, 'CREATE', 'USER', `Created new user: ${username}`);
    res.json({ message: "User created." });
});

app.put('/api/users/:username', authenticateToken, requireAdmin, async (req, res) => {
    const { password, role, perms } = req.body;
    const user = await db.users.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.username === 'admin' && role !== 'admin') return res.status(403).json({ error: "Cannot downgrade main admin." });
    
    let updates = { role: role || user.role, perms: perms || user.perms };
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);
    
    await db.users.update({ username: req.params.username }, { $set: updates });
    await logAudit(req.user.username, 'UPDATE', 'USER', `Modified permissions for: ${req.params.username}`);
    res.json({ message: "User updated." });
});

app.delete('/api/users/:username', authenticateToken, requireAdmin, async (req, res) => {
    if (req.params.username === 'admin') return res.status(403).json({ error: "Cannot delete main admin." });
    await db.users.update({ username: req.params.username }, { $set: { deleted: true, deletedAt: new Date().toISOString(), deletedBy: req.user.username } });
    await logAudit(req.user.username, 'DELETE_SOFT', 'USER', `Revoked access for user: ${req.params.username}`);
    res.json({ message: "User deleted." });
});

// ==========================================
// BACKUP & RESTORE API (WITH CLOUD SYNC)
// ==========================================
const BACKUP_DIR = path.join(process.cwd(), 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

cron.schedule('59 23 * * *', async () => {
    const settingsDB = await db.settings.findOne({ _id: 'global' });
    if (settingsDB && settingsDB.globalPrefs && settingsDB.globalPrefs.enableDailyBackups) {
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            
            const todaysInvoices = await db.invoices.find({ date: { $regex: new RegExp('^' + dateStr) } });
            const dailyRevenue = todaysInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
            dispatchWebhook('reports.daily_summary', {
                date: dateStr,
                totalSales: dailyRevenue,
                totalInvoices: todaysInvoices.length
            });

            const backupFilename = `Auto_Backup_${dateStr}.json`;
            const backupPath = path.join(BACKUP_DIR, backupFilename);
            
            const exportData = {
                usersDB: await db.users.find({}),
                settingsDB: settingsDB,
                productsDB: await db.inventory.find({}),
                invoicesDB: await db.invoices.find({}),
                customersDB: await db.customers.find({}),
                expensesDB: await db.expenses.find({}),
                auditLogs: await db.audit_logs.find({}),
                loginHistory: await db.login_history.find({})
            };
            
            const backupContent = JSON.stringify(exportData, null, 2);
            await fs.promises.writeFile(backupPath, backupContent);

            if (settingsDB.globalPrefs.enableCloud && settingsDB.globalPrefs.cloudProvider === 'aws_s3' && settingsDB.globalPrefs.cloudKey) {
                let s3Config = {
                    accessKeyId: settingsDB.globalPrefs.cloudKey,
                    secretAccessKey: settingsDB.globalPrefs.cloudSecret,
                    s3ForcePathStyle: true, 
                    signatureVersion: 'v4'
                };
                
                if (settingsDB.globalPrefs.cloudEndpoint) {
                    s3Config.endpoint = new AWS.Endpoint(settingsDB.globalPrefs.cloudEndpoint);
                }
                
                const s3 = new AWS.S3(s3Config);

                await s3.putObject({
                    Bucket: settingsDB.globalPrefs.cloudBucket,
                    Key: `POS_Backups/${backupFilename}`,
                    Body: backupContent,
                    ContentType: "application/json"
                }).promise();
                
                console.log(`☁️ Cloud Backup Successful: ${backupFilename}`);
            }
        } catch (error) {
            console.error("Backup failed:", error.message);
        }
    }
});

app.get('/api/backup', authenticateToken, requireAdmin, async (req, res) => {
    const { type } = req.query;
    let exportData = {};
    
    if (type === 'full') {
        exportData = {
            usersDB: await db.users.find({}),
            settingsDB: await db.settings.findOne({ _id: 'global' }),
            productsDB: await db.inventory.find({}),
            invoicesDB: await db.invoices.find({}),
            customersDB: await db.customers.find({}),
            expensesDB: await db.expenses.find({}),
            auditLogs: await db.audit_logs.find({}),
            loginHistory: await db.login_history.find({})
        };
    } else if (type === 'sales' || type === 'reports') {
        exportData = { invoicesDB: await db.invoices.find({}), expensesDB: await db.expenses.find({}) };
    } else if (type === 'sales_reports') {
        exportData = { invoicesDB: await db.invoices.find({}), expensesDB: await db.expenses.find({}), customersDB: await db.customers.find({}) };
    } else if (type === 'settings') {
        exportData = { settingsDB: await db.settings.findOne({ _id: 'global' }) };
    } else if (type === 'full_no_settings') {
        exportData = {
            usersDB: await db.users.find({}), productsDB: await db.inventory.find({}),
            invoicesDB: await db.invoices.find({}), customersDB: await db.customers.find({}), expensesDB: await db.expenses.find({})
        };
    }
    
    await logAudit(req.user.username, 'DOWNLOAD', 'BACKUP', `Triggered manual ${type} backup download.`);
    res.json(exportData);
});

app.post('/api/restore', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const incomingDb = req.body;
        
        if(incomingDb.usersDB) { await db.users.remove({}, { multi: true }); await db.users.insert(incomingDb.usersDB); }
        if(incomingDb.settingsDB) { await db.settings.remove({}, { multi: true }); await db.settings.insert(incomingDb.settingsDB); }
        if(incomingDb.productsDB) { await db.inventory.remove({}, { multi: true }); await db.inventory.insert(incomingDb.productsDB); }
        if(incomingDb.invoicesDB) { await db.invoices.remove({}, { multi: true }); await db.invoices.insert(incomingDb.invoicesDB); }
        if(incomingDb.customersDB) { await db.customers.remove({}, { multi: true }); await db.customers.insert(incomingDb.customersDB); }
        if(incomingDb.expensesDB) { await db.expenses.remove({}, { multi: true }); await db.expenses.insert(incomingDb.expensesDB); }
        if(incomingDb.auditLogs) { await db.audit_logs.remove({}, { multi: true }); await db.audit_logs.insert(incomingDb.auditLogs); }
        
        await logAudit(req.user.username, 'UPDATE', 'SYSTEM_RESTORE', `Performed full database restore from file.`);
        res.json({ message: "Database restored successfully." });
    } catch(e) { res.status(400).json({ error: "Invalid backup file format." }); }
});

// ==========================================
// SYSTEM RESET API
// ==========================================
app.post('/api/reset', authenticateToken, requireAdmin, async (req, res) => {
    const { type } = req.body;
    
    const defaultSettings = { 
        _id: 'global', businessProfile: {}, globalPrefs: {}, customColumns: [], logoBase64: "",
        pdfColumns: [
            { key: 'item', label: 'Item Name', show: true },
            { key: 'qty', label: 'Qty', show: true },
            { key: 'rate', label: 'Price', show: true },
            { key: 'discount', label: 'Discount', show: false },
            { key: 'amount', label: 'Total', show: true }
        ]
    };
    
    if (type === 'full') { 
        await db.invoices.remove({}, { multi: true }); await db.inventory.remove({}, { multi: true }); 
        await db.customers.remove({}, { multi: true }); await db.expenses.remove({}, { multi: true });
        await db.settings.remove({}, { multi: true }); await db.settings.insert(defaultSettings);
    } 
    else if (type === 'sales_only') { 
        await db.invoices.remove({}, { multi: true }); await db.expenses.remove({}, { multi: true }); 
    } 
    else if (type === 'sales_settings_inventory') { 
        await db.invoices.remove({}, { multi: true }); await db.inventory.remove({}, { multi: true }); 
        await db.settings.remove({}, { multi: true }); await db.settings.insert(defaultSettings);
    } 
    else if (type === 'full_except_inventory') { 
        await db.invoices.remove({}, { multi: true }); await db.customers.remove({}, { multi: true }); 
        await db.expenses.remove({}, { multi: true }); await db.settings.remove({}, { multi: true }); 
        await db.settings.insert(defaultSettings);
    }
    
    await logAudit(req.user.username, 'DELETE_HARD', 'SYSTEM_WIPE', `Executed devastating structural reset: ${type}`);
    res.json({ message: "System Data Reset Successfully!" });
});

// ==========================================
// WHATSAPP INTEGRATION (EXTERNAL MODULE)
// ==========================================
const { initWhatsApp, whatsappRouter } = require('./whatsapp.js');
initWhatsApp(db); // Boot up the Puppeteer engine
app.use('/api/whatsapp', authenticateToken, whatsappRouter); // Mount the protected routes

// START SERVER
app.listen(PORT, '0.0.0.0', async () => { 
    console.log(`\n✅ Server is running! Listening on port ${PORT}`); 
    try {
        const browserChoice = process.env.PREFERRED_BROWSER || 'chrome';
        let browserName = (browserChoice.toLowerCase() === 'chrome') ? open.apps.chrome : (browserChoice.toLowerCase() === 'edge' ? open.apps.edge : null);
        await open(`http://localhost:${PORT}`, { app: browserName ? { name: browserName } : undefined });
    } catch (e) { }
});

// =======================================================================
// =======================================================================
// 🏢 HQ BACKGROUND SYNC ENGINE
// =======================================================================
async function pushSalesToHQ() {
    try {
        const config = await db.settings.findOne({ _id: 'global' });
        
        // Prevent syncing if disabled or missing details in the database
        if (!config || !config.globalPrefs || !config.globalPrefs.hqSyncEnabled || !config.globalPrefs.hqEndpoint || !config.globalPrefs.hqBranchId) {
            return;
        }

        const unsyncedInvoices = await db.invoices.find({ isSynced: { $ne: true } });
        if (unsyncedInvoices.length === 0) return; 

        console.log(`🔄 Sync Engine: Found ${unsyncedInvoices.length} new invoices. Pushing to HQ...`);

        const response = await fetch(`${config.globalPrefs.hqEndpoint}/api/hub/receive-sales`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.globalPrefs.hqSecretToken}`, 
                'X-Branch-ID': config.globalPrefs.hqBranchId
            },
            body: JSON.stringify({ sales: unsyncedInvoices })
        });

        if (response.ok) {
            const syncedIds = unsyncedInvoices.map(inv => inv._id);
            await db.invoices.update(
                { _id: { $in: syncedIds } },
                { $set: { isSynced: true } },
                { multi: true }
            );
            console.log(`✅ Sync Engine: Successfully synced ${unsyncedInvoices.length} invoices to HQ.`);
        } else {
            console.error(`⚠️ Sync Engine: HQ rejected the sync payload.`);
        }
    } catch (err) {
        console.error('❌ Sync Engine Network Error:', err.message);
    }
