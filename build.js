const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

console.log("⏳ Starting bundling...");

// BACKEND: PKG-Safe protection
const backendOptions = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    stringArray: false,
    renameGlobals: false,
    ignoreRequireImports: true
};

try {
    // 1. FRONTEND: Bundle the JS folder (Including the new credit_sheet.js!)
    const frontendFiles = [
        'js/api.js', 'js/inventory.js', 'js/billing.js',
        'js/sales_history.js', 'js/crm.js', 'js/Daily_Expenses.js',
        'js/Financial_Reports.js', 'js/settings.js', 'js/main.js', 'js/credit_sheet.js'
    ];

    let combinedFrontend = frontendFiles.map(file => fs.readFileSync(file, 'utf8')).join(';\n\n');
    fs.writeFileSync('app-bundled.js', combinedFrontend);
    console.log("✅ Frontend JS -> app-bundled.js (Clean Bundle)");

    // 2. BACKEND: Obfuscate license.js
    let licenseCode = fs.readFileSync('license.js', 'utf8');
    if (!licenseCode.includes("var CACHE_FILE") && !licenseCode.includes("let CACHE_FILE") && !licenseCode.includes("const CACHE_FILE")) {
        licenseCode = "var CACHE_FILE;\n" + licenseCode;
    }
    const obfuscatedLicense = JavaScriptObfuscator.obfuscate(licenseCode, backendOptions).getObfuscatedCode();
    fs.writeFileSync('license-protected.js', obfuscatedLicense);
    console.log("✅ license.js -> license-protected.js");

    // 3. BACKEND: Obfuscate whatsapp.js
    const waCode = fs.readFileSync('whatsapp.js', 'utf8');
    const obfuscatedWa = JavaScriptObfuscator.obfuscate(waCode, backendOptions).getObfuscatedCode();
    fs.writeFileSync('whatsapp-protected.js', obfuscatedWa);
    console.log("✅ whatsapp.js -> whatsapp-protected.js");

    // 4. BACKEND: Swap the require paths in server.js, then obfuscate
    let serverCode = fs.readFileSync('server.js', 'utf8');
    serverCode = serverCode.replace(/require\(['"]\.\/license\.js['"]\)/g, "require('./license-protected.js')");
    serverCode = serverCode.replace(/require\(['"]\.\/whatsapp\.js['"]\)/g, "require('./whatsapp-protected.js')");

    const obfuscatedServer = JavaScriptObfuscator.obfuscate(serverCode, backendOptions).getObfuscatedCode();
    fs.writeFileSync('server-protected.js', obfuscatedServer);
    console.log("✅ server.js -> server-protected.js");

    console.log("🎉 Build complete! It is now safe to run PKG.");
} catch (error) {
    console.error("❌ Error during build:", error.message);
}