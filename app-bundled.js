;(function() {
    window.API_BASE = "/api"; 
    window.memoryStorage = {};
    
    window.storage = {
        get: function(key) { try { return window.localStorage.getItem(key); } catch(e) { return window.memoryStorage[key] || null; } },
        set: function(key, val) { try { window.localStorage.setItem(key, val); } catch(e) { window.memoryStorage[key] = val; } },
        remove: function(key) { try { window.localStorage.removeItem(key); } catch(e) { delete window.memoryStorage[key]; } },
        clear: function() { try { window.localStorage.clear(); } catch(e) { window.memoryStorage = {}; } }
    };

    window.sessionToken = window.storage.get("token");
    if (window.sessionToken === "undefined" || window.sessionToken === "null") { window.sessionToken = null; window.storage.remove("token"); }

    window.userPerms = [];
    try { const stored = window.storage.get("perms"); if (stored && stored !== "undefined") window.userPerms = JSON.parse(stored); } catch(e) { window.storage.remove("perms"); }

    window.cart = []; 
    window.currentSettings = null;
    window.selectedNextVisit = null; 
    window.inventoryList = []; 
    window.salesHistoryList = []; 
    window.myChart = null; 
    window.editingUsername = null; 
    window.allUsersData = [];
    window.currentSalesPage = 1;
    window.inactivityTimer = null;

    window.showToast = function(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if(!container) return alert(message);
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    };

    window.fetchAPI = async function(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (window.sessionToken) headers['Authorization'] = `Bearer ${window.sessionToken}`;
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);
        
        try {
            const res = await fetch(`${window.API_BASE}${endpoint}`, options);
            if (res.status === 402) { window.triggerLockScreen(); throw new Error("LICENSE_EXPIRED"); }
            if (!res.ok) {
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    const errData = await res.json();
                    if (res.status === 401 || res.status === 403) {
                        if (errData.error === "Session Expired." || errData.error === "Access Denied.") {
                            window.handleLogout(); throw new Error("Session expired. Please log in again.");
                        }
                    }
                    throw new Error(errData.error || `HTTP error! status: ${res.status}`);
                } else { throw new Error(`Server returned error ${res.status}`); }
            }
            return await res.json();
        } catch (error) {
            if (error.message !== "LICENSE_EXPIRED") console.error("API Error:", error);
            throw error;
        }
    };

    window.resetInactivityTimer = function() {
        clearTimeout(window.inactivityTimer);
        if (window.sessionToken) { window.inactivityTimer = setTimeout(() => { window.handleLogout(); window.showToast("System auto-locked for your security.", "error"); }, 10 * 60 * 1000); }
    };

    window.triggerLockScreen = function() {
        const lock = document.getElementById("subscription-lock");
        const auth = document.getElementById("auth-section");
        const app = document.getElementById("app-section");
        if(lock) lock.style.display = "flex";
        if(auth) auth.style.display = "none";
        if(app) app.style.display = "none";
    };

    window.handleLogin = async function() {
        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const username = usernameInput ? usernameInput.value : "";
        const password = passwordInput ? passwordInput.value : "";
        try {
            const data = await window.fetchAPI('/auth/login', 'POST', { username, password });
            window.storage.set("token", data.token); 
            window.storage.set("role", data.role); 
            window.storage.set("perms", JSON.stringify(data.perms));
            window.sessionToken = data.token; 
            window.userPerms = data.perms; 
            window.showApp();
        } catch (err) { 
            if (err.message !== "LICENSE_EXPIRED") window.showToast(err.message || "Login failed.", "error"); 
        }
    };

    window.showApp = function() {
        const auth = document.getElementById("auth-section");
        const app = document.getElementById("app-section");
        if(auth) auth.style.display = "none";
        if(app) app.style.display = "flex";
        if(typeof window.fetchSettings === "function") window.fetchSettings();
    };

    window.handleLogout = function() {
        window.storage.clear();
        window.sessionToken = null;
        window.userPerms = [];
        window.location.reload();
    };
})();;

;(function() {
    window.fetchInventory = async function() {
        try {
            window.inventoryList = await window.fetchAPI('/inventory'); 
            const container = document.getElementById("inventory-container");
            if (container) {
                // Use window.t() to dynamically fetch the right language header!
                let tableHTML = `<table style="margin-top:0; border:none;">
                    <thead><tr>
                        <th>${window.t('lbl_sku')}</th>
                        <th>${window.t('lbl_item_name')}</th>
                        <th>${window.t('lbl_category')}</th>
                        <th>${window.t('ph_price')}</th>
                        <th>${window.t('lbl_stock')}</th>
                        <th>${window.t('lbl_action')}</th>
                    </tr></thead>
                    <tbody>`;
                
                window.inventoryList.forEach(function(item) {
                    let stockUI = '<span style="color:var(--text-muted);">Unlimited</span>';
                    if (item.stock !== null) {
                        stockUI = item.stock <= item.lowStockAlert 
                            ? `<span class="alert-text" style="color: var(--danger); font-weight: bold;">${item.stock} (Low!)</span>` 
                            : `<span class="success-text" style="color: var(--success); font-weight: bold;">${item.stock}</span>`;
                    }
                    const displaySku = (item.barcodes && item.barcodes.length > 1) 
                        ? `<span title="${item.barcodes.join(', ')}">${item.sku} <span style="font-size: 10px; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">+${item.barcodes.length - 1}</span></span>`
                        : item.sku;
                    const actions = (window.storage && window.storage.get("role") === "admin") 
                        ? `<button class="btn-edit" onclick="window.editProduct(${item.id})">Edit</button><button class="btn-danger" onclick="window.deleteProduct(${item.id})">Remove</button>` 
                        : `<span style="color:var(--text-muted);">-</span>`;                  
                    
                    tableHTML += `<tr><td style="font-family:monospace; color:var(--text-muted);">${displaySku}</td><td style="font-weight:600; color:var(--text-main);">${window.escapeHTML(item.name)}</td><td>${window.escapeHTML(item.category)}</td><td style="font-weight:500;">₹${item.price}</td><td>${stockUI}</td><td>${actions}</td></tr>`;
                });
                tableHTML += `</tbody></table>`;
                container.innerHTML = tableHTML;
            }
            
            const datalist = document.getElementById("product-list");
            if (datalist) {
                let datalistHTML = "";
                window.inventoryList.forEach(function(item) { datalistHTML += `<option value="${item.sku} | ${item.name} | ₹${item.price}">`; });
                datalist.innerHTML = datalistHTML;
            }
            
            const selectList = document.getElementById("product-select");
            if (selectList) {
                let selectHTML = "";
                window.inventoryList.forEach(function(item) { selectHTML += `<option value="${item.id}">${item.name} (₹${item.price})</option>`; });
                selectList.innerHTML = selectHTML;
            }
            
            if (typeof window.renderCart === "function") window.renderCart(); 
        } catch (err) {}
    };

    window.addBatchRow = function(batchNo = '', expiry = '', qty = '') {
        const container = document.getElementById("batch-container");
        const row = document.createElement("div"); 
        row.style.cssText = "display: flex; gap: 10px; align-items: center;";
        row.innerHTML = `<input type="text" placeholder="Lot / Batch No" value="${batchNo}" class="batch-no" style="flex: 1; padding: 8px;"><input type="date" value="${expiry}" class="batch-exp" style="flex: 1; padding: 8px;" title="Expiry Date"><input type="number" placeholder="Qty" value="${qty}" class="batch-qty" style="flex: 1; padding: 8px;"><button type="button" class="btn-danger" onclick="this.parentElement.remove()" style="padding: 8px 12px;">✕</button>`;
        container.appendChild(row);
    };

    window.saveProduct = async function() {
        const idEl = document.getElementById("edit-product-id");
        const id = idEl ? idEl.value : "";
        
        let rawSkuEl = document.getElementById("new-sku");
        let rawSku = rawSkuEl ? rawSkuEl.value.trim() : "";
        if (!rawSku) rawSku = "PRD-" + Date.now().toString().slice(-6); 
        const barcodesArray = rawSku.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

        const batches = []; 
        let totalStock = 0;
        document.querySelectorAll("#batch-container > div").forEach(function(row) {
            const bNo = row.querySelector(".batch-no").value.trim(); 
            const bExp = row.querySelector(".batch-exp").value; 
            const bQty = parseInt(row.querySelector(".batch-qty").value);
            if (!isNaN(bQty) && bQty > 0) { 
                batches.push({ batchNo: bNo, expiry: bExp, qty: bQty }); 
                totalStock += bQty; 
            }
        });

        const productPayload = {
            sku: barcodesArray[0], 
            barcodes: barcodesArray, 
            name: document.getElementById("new-name").value.trim(), 
            category: document.getElementById("new-category").value.trim(),
            price: parseFloat(document.getElementById("new-price").value), 
            actualCost: parseFloat(document.getElementById("new-cost").value) || 0,
            taxRate: parseFloat(document.getElementById("new-tax").value) || 0, 
            lowStockAlert: parseInt(document.getElementById("new-alert").value) || 5, 
            stock: batches.length > 0 ? totalStock : null, 
            batches: batches 
        };

        const method = id ? "PUT" : "POST"; 
        const url = id ? `/inventory/${id}` : `/inventory`;
        try { 
            await window.fetchAPI(url, method, productPayload); 
            if(window.showToast) window.showToast("Inventory Updated Successfully", "success"); 
            document.getElementById("addProductForm").style.display = "none"; 
            window.fetchInventory(); 
        } catch (err) { 
            if(err.message !== "LICENSE_EXPIRED" && window.showToast) window.showToast(err.message || "Failed to save product.", "error"); 
        }
    };

    window.editProduct = function(id) {
        const p = (window.inventoryList || []).find(function(i) { return i.id === id; }); 
        if (!p) return;
        
        document.getElementById("edit-product-id").value = p.id; 
        document.getElementById("product-form-title").innerText = "Edit Product"; 
        document.getElementById("new-sku").value = (p.barcodes && p.barcodes.length > 0) ? p.barcodes.join(', ') : p.sku; 
        document.getElementById("new-name").value = p.name; 
        document.getElementById("new-category").value = p.category; 
        document.getElementById("new-price").value = p.price; 
        document.getElementById("new-cost").value = p.actualCost || 0; 
        document.getElementById("new-tax").value = p.taxRate || 18; 
        document.getElementById("new-alert").value = p.lowStockAlert || 5;
        
        const container = document.getElementById("batch-container"); 
        container.innerHTML = "";
        if (p.batches && p.batches.length > 0) { 
            p.batches.forEach(function(b) { window.addBatchRow(b.batchNo, b.expiry, b.qty); }); 
        }
        
        document.getElementById("addProductForm").style.display = "block"; 
        window.scrollTo(0, 0);
    };

    window.showAddProductModal = function() {
        document.getElementById("edit-product-id").value = ""; 
        document.getElementById("product-form-title").innerText = "New Product";
        document.querySelectorAll('#addProductForm input[type="text"], #addProductForm input[type="number"]').forEach(function(input) { input.value = ''; });
        document.getElementById("new-tax").value = "18"; 
        document.getElementById("new-alert").value = "5"; 
        document.getElementById("batch-container").innerHTML = ""; 
        document.getElementById("addProductForm").style.display = "block";
    };

    window.cancelAddProduct = function() { 
        document.getElementById("addProductForm").style.display = "none"; 
    };
    
    window.deleteProduct = async function(id) { 
        if(!confirm("Permanently delete this product?")) return; 
        try { 
            await window.fetchAPI(`/inventory/${id}`, 'DELETE'); 
            window.fetchInventory(); 
        } catch(e) {} 
    };

    window.exportCSV = function() {
        if (!window.inventoryList || window.inventoryList.length === 0) return window.showToast("Inventory is empty!", "error"); 
        let csvContent = "SKU,Barcodes,Name,Category,Selling Price,Actual Cost,Tax Rate,Total Stock,Low Stock Alert\n";
        window.inventoryList.forEach(function(item) { 
            const barcodesStr = item.barcodes ? item.barcodes.join('|') : item.sku;
            const row = [`"${item.sku || ''}"`,`"${barcodesStr}"`,`"${item.name || ''}"`,`"${item.category || ''}"`,item.price || 0,item.actualCost || 0,item.taxRate || 0,item.stock === null ? "" : item.stock,item.lowStockAlert || 0]; 
            csvContent += row.join(",") + "\n"; 
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
        const link = document.createElement("a"); 
        link.href = URL.createObjectURL(blob); 
        link.download = `Inventory_Export_${new Date().toISOString().split('T')[0]}.csv`; 
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link);
    };

    window.handleImportCSV = function(event) {
        const file = event.target.files[0]; 
        if (!file) return; 
        const reader = new FileReader();
        reader.onload = async function(e) {
            const text = e.target.result; 
            const rows = text.split('\n'); 
            if (rows.length < 2) return window.showToast("File appears to be empty or invalid.", "error");
            const parsedItems = [];
            for (let i = 1; i < rows.length; i++) {
                if (!rows[i].trim()) continue; 
                const values = rows[i].split(',').map(function(v) { return v.trim().replace(/(^"|"$)/g, ''); });
                if (values.length >= 4) { 
                    parsedItems.push({ sku: values[0] || "", name: values[1] || "", category: values[2] || "Uncategorized", price: parseFloat(values[3]) || 0, actualCost: parseFloat(values[4]) || 0, taxRate: parseFloat(values[5]) || 18, stock: values[6] === "" || values[6] === undefined ? null : parseInt(values[6]), lowStockAlert: parseInt(values[7]) || 0 }); 
                }
            }
            if (parsedItems.length === 0) return window.showToast("No valid items found.", "error");
            try { 
                const res = await window.fetchAPI('/inventory/bulk', 'POST', parsedItems); 
                window.showToast(res.message, "success"); 
                window.fetchInventory(); 
            } catch (err) { 
                if(err.message !== "LICENSE_EXPIRED") window.showToast("Import failed: " + err.message, "error"); 
            }
            document.getElementById('importExcelInput').value = '';
        }; 
        reader.readAsText(file);
    };

    window.downloadTemplate = function() {
        const csvContent = "SKU,Name,Category,Selling Price,Actual Cost,Tax Rate,Stock,Low Stock Alert\nSAMPLE1,Example Item,General,100,80,18,50,5";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a"); 
        link.href = URL.createObjectURL(blob); 
        link.download = "Inventory_Template.csv"; 
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link);
    };
})();;

;(function() {
    window.cart = [];
    window.selectedNextVisit = null;
    window.loyaltyRedeemed = 0;

    window.setNextVisit = function(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        window.selectedNextVisit = date.toISOString();
        document.getElementById("next-visit-display").innerText = "Selected: " + date.toLocaleDateString();
        document.getElementById("custom-next-visit").value = "";
    };

    window.setCustomNextVisit = function(dateStr) {
        if(!dateStr) { window.selectedNextVisit = null; return; }
        window.selectedNextVisit = new Date(dateStr).toISOString();
        document.getElementById("next-visit-display").innerText = "Selected: " + new Date(window.selectedNextVisit).toLocaleDateString();
    };

    window.addToCart = async function() {
        try {
            const searchInput = document.getElementById("product-search");
            const searchVal = searchInput ? searchInput.value.trim() : "";
            if(!searchVal) return;

            if (!window.inventoryList || window.inventoryList.length === 0) {
                try {
                    window.inventoryList = await window.fetchAPI('/inventory');
                } catch (err) {
                    alert("Network error: Could not load inventory from database.");
                    return;
                }
            }

            let item = window.inventoryList.find(function(i) {
                const skuMatch = String(i.sku).toLowerCase() === searchVal.toLowerCase();
                const nameMatch = String(i.name).toLowerCase() === searchVal.toLowerCase();
                const barcodeMatch = Array.isArray(i.barcodes) ? i.barcodes.some(b => String(b).toLowerCase() === searchVal.toLowerCase()) : false;
                return skuMatch || nameMatch || barcodeMatch;
            });

            if (!item && searchVal.includes(' | ')) {
                const parts = searchVal.split(' | ');
                const extractedSku = parts[0].trim().toLowerCase();
                item = window.inventoryList.find(function(i) { return String(i.sku).toLowerCase() === extractedSku; });
            }

            if (!item) {
                if(window.showToast) window.showToast("Item or Barcode not found in inventory.", "error");
                else alert("Item or Barcode not found in inventory.");
                return;
            }

            const qtyInput = document.getElementById("qty-input");
            const qty = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;

            if (qty > 0) {
                if(!window.cart) window.cart = [];
                const existingItem = window.cart.find(function(c) { return c.id === item.id; });
                if (existingItem) {
                    existingItem.qty += qty;
                } else {
                    window.cart.push({ id: item.id, name: item.name, price: item.price, qty: qty, discount: 0, customFields: {} });
                }

                if (typeof window.renderCart === "function") window.renderCart();
                if (searchInput) { searchInput.value = ""; searchInput.focus(); }
                if (qtyInput) qtyInput.value = "1";
            }
        } catch (fatalError) {
            alert("CRITICAL CART ERROR: " + fatalError.message);
        }
    };

    window.addCustomToCart = function() {
        const nameInput = document.getElementById("custom-name");
        const priceInput = document.getElementById("custom-price");
        const qtyInput = document.getElementById("custom-qty");

        const name = nameInput ? nameInput.value.trim() : "";
        const price = priceInput ? parseFloat(priceInput.value) : NaN;
        const qty = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;

        if (!name || isNaN(price) || price < 0 || qty < 1) {
            if(window.showToast) window.showToast("Please enter valid item details.", "error");
            return;
        }

        if(!window.cart) window.cart = [];
        window.cart.push({ id: 'custom', name: name, price: price, qty: qty, discount: 0, customFields: {} });

        if(nameInput) nameInput.value = "";
        if(priceInput) priceInput.value = "";
        if(qtyInput) qtyInput.value = "1";

        if (typeof window.renderCart === "function") window.renderCart();
    };

    window.updateCartCustomField = function(cartIndex, fieldName, value) {
        if(window.cart[cartIndex]) window.cart[cartIndex].customFields[fieldName] = value;
    };

    window.updateCartDiscount = function(cartIndex, value) {
        if(window.cart[cartIndex]) window.cart[cartIndex].discount = parseFloat(value) || 0;
        if (typeof window.renderCart === "function") window.renderCart();
    };

    window.removeFromCart = function(index) {
        window.cart.splice(index, 1);
        if (typeof window.renderCart === "function") window.renderCart();
    };

    window.renderCart = function() {
        const settings = window.currentSettings || {
            customColumns: [],
            pdfColumns: [
                { key: 'item', label: 'Item Name', show: true },
                { key: 'qty', label: 'Qty', show: true },
                { key: 'rate', label: 'Price', show: true },
                { key: 'discount', label: 'Discount', show: false },
                { key: 'amount', label: 'Total', show: true }
            ],
            globalPrefs: { taxEnable: false, taxRate: 0, taxType: 'exclusive', taxName: 'Tax' }
        };

        const customCols = settings.customColumns || [];
        const pdfCols = settings.pdfColumns || [];
        const showDiscountToggle = document.getElementById("bill-show-discount-col");

        const activeCols = pdfCols.filter(function(c) {
            if (c.key === 'discount') {
                return showDiscountToggle ? showDiscountToggle.checked : c.show;
            }
            return c.show;
        });

        const headerTr = document.getElementById("cart-headers");
        if(headerTr) {
            let hHTML = "";
            activeCols.forEach(function(col) { hHTML += `<th>${col.label}</th>`; });
            customCols.forEach(function(col) { hHTML += `<th>${col}</th>`; });
            hHTML += `<th></th>`;
            headerTr.innerHTML = hHTML;
        }

        const list = document.getElementById("cart-list");
        let gross = 0;

        if(list) {
            let listHTML = "";
            (window.cart || []).forEach(function(item, index) {
                const itemDisc = item.discount || 0;
                const amount = (item.price * item.qty) - itemDisc;
                gross += amount;

                let rowHTML = "<tr>";
                activeCols.forEach(function(col) {
                    if(col.key === 'item') rowHTML += `<td style="font-weight: 600;">${window.escapeHTML ? window.escapeHTML(item.name) : item.name}</td>`;
                    else if(col.key === 'qty') rowHTML += `<td>${item.qty}</td>`;
                    else if(col.key === 'rate') rowHTML += `<td>₹${item.price.toFixed(2)}</td>`;
                    else if(col.key === 'discount') rowHTML += `<td><input type="number" style="width:80px; padding:6px;" value="${itemDisc}" onchange="window.updateCartDiscount(${index}, this.value)"></td>`;
                    else if(col.key === 'amount') rowHTML += `<td style="font-weight: 600; color:var(--primary);">₹${amount.toFixed(2)}</td>`;
                    else {
                        const val = (item.customFields && item.customFields[col.key]) ? item.customFields[col.key] : "";
                        rowHTML += `<td><input type="text" style="width:90px; padding:6px;" placeholder="${col.label}" value="${val}" onchange="window.updateCartCustomField(${index}, '${col.key}', this.value)"></td>`;
                    }
                });
                customCols.forEach(function(col) {
                    const val = (item.customFields && item.customFields[col]) ? item.customFields[col] : "";
                    rowHTML += `<td><input type="text" style="width:100px; padding:6px;" placeholder="${col}" value="${val}" onchange="window.updateCartCustomField(${index}, '${col}', this.value)"></td>`;
                });
                rowHTML += `<td><button onclick=\"window.removeFromCart(${index})\" class=\"btn-danger\" style=\"padding: 6px 10px;\">✖</button></td></tr>`;
                listHTML += rowHTML;
            });
            list.innerHTML = listHTML;
        }

        const uiGross = document.getElementById("ui-gross");
        if (uiGross) uiGross.innerText = `₹${gross.toFixed(2)}`;

        const dValInput = document.getElementById("discount-val");
        const dTypeInput = document.getElementById("discount-type");
        const dVal = dValInput ? (parseFloat(dValInput.value) || 0) : 0;
        const dType = dTypeInput ? dTypeInput.value : "flat";

        let discountAmt = dType === 'percent' ? gross * (dVal / 100) : dVal;
        if (discountAmt > gross) discountAmt = gross;
        const postDiscount = gross - discountAmt;

        const prefs = settings.globalPrefs || {};
        const taxEnable = prefs.taxEnable === true || prefs.enableGst === true;
        const taxType = prefs.taxType || 'exclusive';
        const taxRules = Array.isArray(prefs.taxRules) ? prefs.taxRules : [];

        let totalTaxAmt = 0;
        let grandTotal = postDiscount;
        const taxRow = document.getElementById("ui-tax-row");
        const taxLabelEl = document.getElementById("ui-tax-label");
        const taxValEl = document.getElementById("ui-tax-val");

        // Clear out any previous detailed breakdowns stored on the UI element
        if (taxLabelEl) taxLabelEl.innerHTML = 'Tax:';
        if (taxValEl) taxValEl.innerHTML = '₹0.00';
        
        // We will store the detailed breakdown globally so the checkout function can grab it
        window.currentCartTaxDetails = [];

        if (taxEnable && taxRules.length > 0) {
            if(taxRow) taxRow.style.display = "block"; // Changed to block to allow multi-line stacking
            
            let combinedLabelHTML = '';
            let combinedValueHTML = '';
            let combinedInclusiveRate = 0;

            if (taxType === 'exclusive') {
                // Exclusive math is easy: apply each rate individually to the base amount
                taxRules.forEach(rule => {
                    const rate = parseFloat(rule.rate) || 0;
                    if (rate <= 0) return;
                    
                    const amt = postDiscount * (rate / 100);
                    totalTaxAmt += amt;
                    
                    combinedLabelHTML += `<div style="text-align:left; margin-bottom:4px;">${rule.name} (${rate}%):</div>`;
                    combinedValueHTML += `<div style="text-align:right; margin-bottom:4px;">₹${amt.toFixed(2)}</div>`;
                    
                    window.currentCartTaxDetails.push({ name: rule.name, rate: rate, amount: amt });
                });
                grandTotal = postDiscount + totalTaxAmt;
                
            } else {
                // Inclusive math: sum the total rate first to find the base value out of the total
                taxRules.forEach(rule => { combinedInclusiveRate += (parseFloat(rule.rate) || 0); });
                
                if (combinedInclusiveRate > 0) {
                    totalTaxAmt = postDiscount - (postDiscount / (1 + (combinedInclusiveRate / 100)));
                    grandTotal = postDiscount;
                    
                    // Now proportionately split the total tax among the rules
                    taxRules.forEach(rule => {
                        const rate = parseFloat(rule.rate) || 0;
                        if (rate <= 0) return;
                        
                        // Ratio of this rule's rate to the combined rate
                        const amt = totalTaxAmt * (rate / combinedInclusiveRate);
                        
                        combinedLabelHTML += `<div style="text-align:left; margin-bottom:4px; font-size:11px;">Incl. ${rule.name} (${rate}%):</div>`;
                        combinedValueHTML += `<div style="text-align:right; margin-bottom:4px; font-size:11px;">₹${amt.toFixed(2)}</div>`;
                        
                        window.currentCartTaxDetails.push({ name: rule.name, rate: rate, amount: amt });
                    });
                }
            }

            if(taxLabelEl) taxLabelEl.innerHTML = combinedLabelHTML;
            if(taxValEl) taxValEl.innerHTML = combinedValueHTML;

        } else {
            if(taxRow) taxRow.style.display = "none";
        }

        const totalsEl = document.getElementById("ui-total");
        if (totalsEl) {
            totalsEl.dataset.rawtotal = grandTotal.toFixed(2);
            totalsEl.dataset.gross = gross.toFixed(2);
            totalsEl.dataset.discount = discountAmt.toFixed(2);
            totalsEl.dataset.tax = taxAmt.toFixed(2);
            totalsEl.innerText = `₹${grandTotal.toFixed(2)}`;
        }
    };

    window.openCheckoutModal = function() {
        if (!window.cart || window.cart.length === 0) {
            if(window.showToast) window.showToast("Cart is empty", "error");
            return;
        }

        const prefs = window.currentSettings && window.currentSettings.globalPrefs ? window.currentSettings.globalPrefs : {};

        const gCash = document.getElementById("grp-cash"); if(gCash) gCash.style.display = prefs.payCash !== false ? "block" : "none";
        const gUpi = document.getElementById("grp-upi"); if(gUpi) gUpi.style.display = prefs.payUpi !== false ? "block" : "none";
        const gCard = document.getElementById("grp-card"); if(gCard) gCard.style.display = prefs.payCard !== false ? "block" : "none";
        const gWallet = document.getElementById("grp-wallet"); if(gWallet) gWallet.style.display = prefs.payWallet !== false ? "block" : "none";

        const phoneInput = document.getElementById("cust-phone");
        const phone = phoneInput ? phoneInput.value.trim() : "";
        const loyaltySec = document.getElementById("loyalty-points-section");

        if (phone && window.allCustomersData) {
            const cust = window.allCustomersData.find(function(c) { return c.phone === phone; });
            if (cust && cust.loyaltyPoints > 0) {
                if(loyaltySec) loyaltySec.style.display = "block";
                const bal = document.getElementById("pay-loyalty-balance");
                if(bal) bal.innerText = cust.loyaltyPoints;
            } else {
                if(loyaltySec) loyaltySec.style.display = "none";
            }
        } else {
            if(loyaltySec) loyaltySec.style.display = "none";
        }

        document.querySelectorAll(".pay-input").forEach(function(input) { input.value = ""; });
        window.loyaltyRedeemed = 0;

        const totalsEl = document.getElementById("ui-total");
        const grandTotal = totalsEl ? parseFloat(totalsEl.dataset.rawtotal) : 0;

        const payGrandEl = document.getElementById("pay-grand-total");
        if(payGrandEl) payGrandEl.innerText = `₹${grandTotal.toFixed(2)}`;

        if (typeof window.calculateDue === "function") window.calculateDue();

        const cModal = document.getElementById("checkoutModal");
        if (cModal) cModal.style.display = "flex";
    };

    window.applyLoyaltyPoints = function() {
        const balEl = document.getElementById("pay-loyalty-balance");
        const balance = balEl ? parseFloat(balEl.innerText) : 0;

        const totalsEl = document.getElementById("ui-total");
        const grandTotal = totalsEl ? parseFloat(totalsEl.dataset.rawtotal) : 0;

        window.loyaltyRedeemed = Math.min(balance, grandTotal);

        const loyaltySec = document.getElementById("loyalty-points-section");
        if(loyaltySec) loyaltySec.innerHTML = `<span style="color:var(--success); font-weight:bold;">₹${window.loyaltyRedeemed} Loyalty Points Applied!</span>`;

        if (typeof window.calculateDue === "function") window.calculateDue();
    };

    window.calculateDue = function() {
        const totalsEl = document.getElementById("ui-total");
        const grandTotal = totalsEl ? parseFloat(totalsEl.dataset.rawtotal) : 0;

        const cInput = document.getElementById("pay-cash"); const cash = cInput ? (parseFloat(cInput.value) || 0) : 0;
        const uInput = document.getElementById("pay-upi"); const upi = uInput ? (parseFloat(uInput.value) || 0) : 0;
        const cdInput = document.getElementById("pay-card"); const card = cdInput ? (parseFloat(cdInput.value) || 0) : 0;
        const wInput = document.getElementById("pay-wallet"); const wallet = wInput ? (parseFloat(wInput.value) || 0) : 0;

        const totalPaid = cash + upi + card + wallet + (window.loyaltyRedeemed || 0);
        const due = grandTotal - totalPaid;

        const dueEl = document.getElementById("pay-due");
        const warning = document.getElementById("credit-warning");
        const phoneInput = document.getElementById("cust-phone");
        const phone = phoneInput ? phoneInput.value.trim() : "";

        if (due > 0) {
            if(dueEl) { dueEl.innerText = `₹${due.toFixed(2)} (Credit Due)`; dueEl.style.color = "var(--danger)"; }
            if(warning) warning.style.display = phone ? "none" : "block";
        } else if (due < 0) {
            if(dueEl) { dueEl.innerText = `₹${Math.abs(due).toFixed(2)} (Change Return / Overpaid)`; dueEl.style.color = "var(--primary)"; }
            if(warning) warning.style.display = "none";
        } else {
            if(dueEl) { dueEl.innerText = `₹0.00 (Fully Paid)`; dueEl.style.color = "var(--success)"; }
            if(warning) warning.style.display = "none";
        }
    };

    window.finalizeCheckout = async function() {
        const dueEl = document.getElementById("pay-due");
        const dueText = dueEl ? dueEl.innerText : "";
        const rawDueValue = parseFloat(dueText.replace(/[^0-9.-]+/g,"")) || 0;

        const phoneInput = document.getElementById("cust-phone");
        const phone = phoneInput ? phoneInput.value.trim() : "";

        let creditAdjustment = 0;
        if (dueText.includes("Credit")) {
            if (!phone) {
                if(window.showToast) window.showToast("Customer Phone Number required to log Khata / Credit.", "error");
                return;
            }
            creditAdjustment = rawDueValue;
        } else if (dueText.includes("Overpaid")) {
            creditAdjustment = -Math.abs(rawDueValue);
        }

        const cNameInput = document.getElementById("cust-name");
        const dValInput = document.getElementById("discount-val");
        const dTypeInput = document.getElementById("discount-type");

        const cCashInput = document.getElementById("pay-cash");
        const cUpiInput = document.getElementById("pay-upi");
        const cCardInput = document.getElementById("pay-card");
        const cWalletInput = document.getElementById("pay-wallet");

        const payload = {
            customerName: cNameInput ? cNameInput.value.trim() : "",
            phone: phone,
            discountVal: dValInput ? (parseFloat(dValInput.value) || 0) : 0,
            discountType: dTypeInput ? dTypeInput.value : "flat",
            nextVisit: window.selectedNextVisit,
            items: window.cart,
            payments: {
                cash: cCashInput ? (parseFloat(cCashInput.value) || 0) : 0,
                upi: cUpiInput ? (parseFloat(cUpiInput.value) || 0) : 0,
                card: cCardInput ? (parseFloat(cCardInput.value) || 0) : 0,
                wallet: cWalletInput ? (parseFloat(cWalletInput.value) || 0) : 0,
                loyalty: window.loyaltyRedeemed || 0,
                creditDue: creditAdjustment
            },
            // ✅ NEW: Push the multi-tier array to the database
            taxDetails: window.currentCartTaxDetails || [], 
            taxConfig: {
                type: (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.taxType) ? window.currentSettings.globalPrefs.taxType : 'exclusive'
            }
        };

        try {
            const data = await window.fetchAPI('/invoices', 'POST', payload);
            const cModal = document.getElementById("checkoutModal");
            if (cModal) cModal.style.display = "none";

            if(window.showToast) window.showToast(`Success! Receipt ${data.invoice.id} Generated.`, "success");

            // ✅ FIXED LOGIC: Always try to send WhatsApp if Engine is Enabled and Phone is provided!
            if (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.enableWhatsapp && phone && typeof window.sendWhatsAppReceipt === "function") {
                await window.sendWhatsAppReceipt();
            }

            if (typeof window.executeUniversalPrint === "function") window.executeUniversalPrint();

            window.cart = [];
            if(cNameInput) cNameInput.value = "";
            if(phoneInput) phoneInput.value = "";
            if(dValInput) dValInput.value = "0";

            if (typeof window.renderCart === "function") window.renderCart();
            if (typeof window.fetchCustomers === "function") window.fetchCustomers();
			// ✅ ADD THIS LINE: Force the Credit Ledger to update instantly!
            if (typeof window.fetchCreditLedger === "function") window.fetchCreditLedger();
			
            if (typeof window.fetchDashboardStats === "function") window.fetchDashboardStats();
        } catch (err) {
            if(window.showToast) window.showToast("Checkout failed.", "error");
        }
    };

    window.executeUniversalPrint = function() {
        if (!window.cart || window.cart.length === 0) return;
        const format = (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.printFormat) ? window.currentSettings.globalPrefs.printFormat : "thermal";

        if (format === 'thermal') { if(typeof window.printThermalReceipt === "function") window.printThermalReceipt(); }
        else if (format === 'a4' || format === 'a5') { if(typeof window.generateInvoicePDF === "function") window.generateInvoicePDF('print', format); }
        else if (format === 'dotmatrix') { if(typeof window.printDotMatrix === "function") window.printDotMatrix(); }
        else if (format === 'barcode') { if(typeof window.printBarcodeSlip === "function") window.printBarcodeSlip(); }
        else if (format === 'digital') { if(window.showToast) window.showToast("📱 Digital Format active. Used WhatsApp to send.", "success"); }
    };

    window.printThermalReceipt = function() {
        if (!window.cart || window.cart.length === 0) return;
        const prefs = window.currentSettings && window.currentSettings.globalPrefs ? window.currentSettings.globalPrefs : {};
        const bp = window.currentSettings && window.currentSettings.businessProfile ? window.currentSettings.businessProfile : {};
        const width = prefs.printerWidth || "80mm";
        const pxWidth = width === '58mm' ? '180px' : '260px';

        let receiptHtml = `<div style="text-align: center; margin-bottom: 10px;"><h3 style="margin: 0; font-size: 16px;">${bp.name || "Our Shop"}</h3><div style="font-size: 10px; margin-top: 5px;">Date: ${new Date().toLocaleString()}</div><hr style="border-top: 1px dashed #000; margin: 10px 0;"></div><table style="width: 100%; font-size: 11px; text-align: left; border-collapse: collapse;"><tr><th style="padding-bottom: 5px;">Item</th><th style="padding-bottom: 5px; text-align: center;">Qty</th><th style="padding-bottom: 5px; text-align: right;">Total</th></tr>`;
        window.cart.forEach(function(item) {
            const amount = (item.price * item.qty) - (item.discount || 0);
            receiptHtml += `<tr><td style="padding-bottom: 3px;">${item.name}</td><td style="text-align: center;">${item.qty}</td><td style="text-align: right;">${amount.toFixed(2)}</td></tr>`;
        });

        const totalsEl = document.getElementById("ui-total");
        const dts = totalsEl ? totalsEl.dataset : { discount: 0, tax: 0, rawtotal: 0 };

        receiptHtml += `</table><hr style="border-top: 1px dashed #000; margin: 10px 0;"><div style="font-size: 12px; text-align: right;">`;
        if (parseFloat(dts.discount) > 0) receiptHtml += `<div>Discount: -${dts.discount}</div>`;
        
        // ✅ Dynamic Multi-Tier Tax Loop for Thermal Printers
        if (window.currentCartTaxDetails && window.currentCartTaxDetails.length > 0) {
            window.currentCartTaxDetails.forEach(t => {
                receiptHtml += `<div>${t.name} (${t.rate}%): +${t.amount.toFixed(2)}</div>`;
            });
        } else if (parseFloat(dts.tax) > 0) {
            receiptHtml += `<div>Tax: +${dts.tax}</div>`; // Legacy fallback
        }

        receiptHtml += `<div style="font-weight: bold; font-size: 14px; margin-top: 5px;">Total: ₹${dts.rawtotal}</div></div><hr style="border-top: 1px dashed #000; margin: 10px 0;"><div style="text-align: center; font-size: 10px;">Thank you!</div>`;

        const printWindow = window.open('', '', 'width=400,height=600');
        printWindow.document.write(`<html><head><style>body { font-family: monospace; color: #000; margin: 0; padding: 10px; width: ${pxWidth}; } @media print { @page { margin: 0; size: auto; } }</style></head><body>${receiptHtml}</body></html>`);
        printWindow.document.close(); printWindow.focus();
        setTimeout(function() { printWindow.print(); printWindow.close(); }, 250);
    };

    window.printDotMatrix = function() {
        if (!window.cart || window.cart.length === 0) return;
        const bp = window.currentSettings && window.currentSettings.businessProfile ? window.currentSettings.businessProfile : {};
        let text = `<pre style="font-family: monospace; font-size: 14px;">`;
        text += `${bp.name || "INVOICE"}\nDate: ${new Date().toLocaleString()}\n----------------------------------------\nITEM                  QTY    TOTAL\n----------------------------------------\n`;
        window.cart.forEach(function(item) {
            const amount = (item.price * item.qty) - (item.discount || 0);
            const safeName = item.name || "";
            text += `${safeName.substring(0,20).padEnd(22)} ${item.qty.toString().padEnd(6)} ${amount.toFixed(2)}\n`;
        });
        const totalsEl = document.getElementById("ui-total");
        const totalText = totalsEl ? totalsEl.innerText : "₹0.00";
        text += `----------------------------------------\nGRAND TOTAL:                 ${totalText}\n</pre>`;

        const printWindow = window.open('', '', 'width=600,height=600');
        printWindow.document.write(`<html><body>${text}</body></html>`);
        printWindow.document.close(); printWindow.focus();
        setTimeout(function() { printWindow.print(); printWindow.close(); }, 500);
    };

    window.printBarcodeSlip = function() {
        if (!window.cart || window.cart.length === 0) return;
        const tempInvoiceId = "INV-" + Date.now().toString().slice(-6);

        const scriptStart = "<scr" + "ipt src=\"https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js\"></scr" + "ipt>";
        const scriptBody = "<scr" + "ipt>window.onload = function() { try { JsBarcode(\"#barcode\", \"" + tempInvoiceId + "\", { format: \"CODE128\", width: 1.5, height: 40, displayValue: true, fontSize: 12, margin: 0 }); setTimeout(function() { window.print(); window.close(); }, 500); } catch(e) { window.print(); window.close(); } };</scr" + "ipt>";
        const barcodeScript = scriptStart + scriptBody;

        const prefs = window.currentSettings && window.currentSettings.globalPrefs ? window.currentSettings.globalPrefs : {};
        const width = prefs.printerWidth || "80mm";
        const pxWidth = width === '58mm' ? '180px' : '260px';
        const bp = window.currentSettings && window.currentSettings.businessProfile ? window.currentSettings.businessProfile : {};

        let receiptHtml = `<div style="text-align: center; margin-bottom: 10px;"><h3 style="margin: 0; font-size: 16px;">${bp.name || "Our Shop"}</h3><div style="font-size: 10px; margin-top: 5px;">Date: ${new Date().toLocaleString()}</div><div style="font-weight: bold; font-size: 14px; margin-top: 5px; text-transform: uppercase;">Order Slip</div><hr style="border-top: 1px solid #000; margin: 10px 0;"></div><table style="width: 100%; font-size: 11px; text-align: left; border-collapse: collapse;"><tr><th style="padding-bottom: 5px; border-bottom: 1px dashed #000;">Item</th><th style="padding-bottom: 5px; text-align: right; border-bottom: 1px dashed #000;">Qty</th></tr>`;
        window.cart.forEach(function(item) {
            receiptHtml += `<tr><td style="padding: 5px 0;">${item.name}</td><td style="text-align: right; font-weight: bold; padding: 5px 0;">x${item.qty}</td></tr>`;
        });
        receiptHtml += `</table><hr style="border-top: 1px solid #000; margin: 10px 0;"><div style="text-align: center; margin-top: 15px;"><svg id="barcode"></svg></div>`;

        const printWindow = window.open('', '', 'width=400,height=600');
        printWindow.document.write(`<html><head><style>body { font-family: monospace; color: #000; margin: 0; padding: 10px; width: ${pxWidth}; } @media print { @page { margin: 0; size: auto; } }</style></head><body>${receiptHtml}${barcodeScript}</body></html>`);
        printWindow.document.close(); printWindow.focus();
    };

    window.generateInvoicePDF = function(outputType, formatStr) {
        if (!outputType) outputType = 'download';
        if (!formatStr) formatStr = 'a4';

        if (!window.cart || window.cart.length === 0) return null;
        if (!window.jspdf && !window.jsPDF) {
            console.error("PDF Engine (jsPDF) is not loaded!");
            return null;
        }
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        const bp = window.currentSettings && window.currentSettings.businessProfile ? window.currentSettings.businessProfile : {};
        let doc;

        if (formatStr === 'thermal') {
            doc = new jsPDF({ format: [80, 200] }); doc.setFontSize(16); doc.text(bp.name || "Invoice", 40, 15, { align: 'center' }); doc.setFontSize(9); doc.setTextColor(100, 116, 139); doc.text(new Date().toLocaleString(), 40, 22, { align: 'center' });
            const tableRows = window.cart.map(function(item) { return [item.name.substring(0,15), item.qty, ((item.price * item.qty) - (item.discount||0)).toFixed(2)]; });
            doc.autoTable({ startY: 30, margin: { left: 5, right: 5 }, head: [['Item', 'Qty', 'Total']], body: tableRows, theme: 'plain', styles: { fontSize: 8, cellPadding: 1 } });
            const finalY = doc.lastAutoTable.finalY + 8;
            doc.setFontSize(12);
            const totalsEl = document.getElementById("ui-total");
            const rawTotal = totalsEl ? totalsEl.dataset.rawtotal : "0";
            doc.text(`Total: Rs. ${rawTotal}`, 75, finalY, { align: 'right' });
        } else if (formatStr === 'dotmatrix') {
            doc = new jsPDF({ format: 'a4' }); doc.setFont("courier", "normal"); doc.setFontSize(12); let y = 20;
            doc.text(bp.name || "INVOICE", 15, y); y += 10; doc.text(`Date: ${new Date().toLocaleString()}`, 15, y); y += 10; doc.text("--------------------------------------------------", 15, y); y += 10; doc.text("ITEM                  QTY    TOTAL", 15, y); y += 10; doc.text("--------------------------------------------------", 15, y); y += 10;
            window.cart.forEach(function(item) {
                const amt = (item.price * item.qty) - (item.discount || 0);
                const safeName = item.name || "";
                doc.text(`${safeName.substring(0,20).padEnd(22)} ${item.qty.toString().padEnd(6)} ${amt.toFixed(2)}`, 15, y); y += 7;
            });
            doc.text("--------------------------------------------------", 15, y); y += 10;
            const totalsEl = document.getElementById("ui-total");
            const rawTotal = totalsEl ? totalsEl.dataset.rawtotal : "0";
            doc.text(`GRAND TOTAL:                 Rs. ${rawTotal}`, 15, y);
        } else if (formatStr === 'barcode') {
            doc = new jsPDF({ format: [80, 100] }); doc.setFontSize(14); doc.text("ORDER SLIP", 40, 15, { align: 'center' }); doc.setFontSize(10); doc.text(bp.name || "Shop", 40, 22, { align: 'center' });
            const tbBody = window.cart.map(function(item) { return [item.name, `x${item.qty}`]; });
            doc.autoTable({ startY: 30, margin: { left: 5, right: 5 }, head: [['Item', 'Qty']], body: tbBody, theme: 'plain', styles: { fontSize: 9 } });
            doc.setFontSize(14); doc.text(`*INV-${Date.now().toString().slice(-6)}*`, 40, doc.lastAutoTable.finalY + 15, { align: 'center' });
        } else {
            doc = new jsPDF({ format: formatStr === 'a5' ? 'a5' : 'a4' }); let startX = 14; let textY = 22;
            if (window.currentSettings && window.currentSettings.logoBase64) { try { const imgType = window.currentSettings.logoBase64.substring("data:image/".length, window.currentSettings.logoBase64.indexOf(";base64")).toUpperCase(); doc.addImage(window.currentSettings.logoBase64, imgType, 14, 12, 28, 28); startX = 48; textY = 20; } catch (e) {} }
            doc.setFontSize(22); doc.setTextColor(15, 23, 42); doc.text(bp.name || "Invoice", startX, textY); doc.setFontSize(10); doc.setTextColor(100, 116, 139); let y = textY + 8;
            if (bp.tagline) { doc.text(bp.tagline, startX, y); y += 5; } if (bp.address1) { doc.text(bp.address1, startX, y); y += 5; } if (bp.address2) { doc.text(bp.address2, startX, y); y += 5; } if (bp.phone) { doc.text(`Phone: ${bp.phone}`, startX, y); y += 5; }
            y = Math.max(y, 45); doc.setFontSize(14); doc.setTextColor(79, 70, 229); doc.text("RECEIPT", 150, 22); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
            let dateStr = ""; const now = new Date(); if (bp.showDate) dateStr += now.toLocaleDateString() + " "; if (bp.showTime) dateStr += now.toLocaleTimeString(); if (dateStr) doc.text(`Date: ${dateStr}`, 150, 30);

            const cNameInput = document.getElementById("cust-name"); const custName = (cNameInput && cNameInput.value.trim()) ? cNameInput.value.trim() : "Walk-in Customer";
            doc.setTextColor(15, 23, 42); doc.text(`Billed To: ${custName}`, 14, y + 10);

            const cPhoneInput = document.getElementById("cust-phone"); const custPhone = cPhoneInput ? cPhoneInput.value.trim() : "";
            doc.setTextColor(100, 116, 139); if (custPhone) { doc.text(`Phone: ${custPhone}`, 14, y + 16); y += 6; }

            if (window.selectedNextVisit) { doc.setTextColor(16, 185, 129); doc.text(`Next Visit: ${new Date(window.selectedNextVisit).toLocaleDateString()}`, 14, y + 16); doc.setTextColor(0); y += 6; }

            const customCols = (window.currentSettings && window.currentSettings.customColumns) ? window.currentSettings.customColumns : [];
            const pdfCols = (window.currentSettings && window.currentSettings.pdfColumns) ? window.currentSettings.pdfColumns : [];
            const showDiscountToggle = document.getElementById("bill-show-discount-col");
            const activeCols = pdfCols.filter(function(c) { return c.key === 'discount' ? (showDiscountToggle ? showDiscountToggle.checked : c.show) : c.show; });
            const tableColumn = activeCols.map(function(c) { return c.label; }).concat(customCols);

            const tableRows = [];
            window.cart.forEach(function(item) {
                const row = []; const itemDisc = item.discount || 0; const amount = (item.price * item.qty) - itemDisc;
                activeCols.forEach(function(col) {
                    if(col.key === 'item') row.push(item.name);
                    else if(col.key === 'qty') row.push(item.qty.toString());
                    else if(col.key === 'rate') row.push(`Rs. ${item.price.toFixed(2)}`);
                    else if(col.key === 'discount') row.push(`Rs. ${itemDisc.toFixed(2)}`);
                    else if(col.key === 'amount') row.push(`Rs. ${amount.toFixed(2)}`);
                    else row.push((item.customFields && item.customFields[col.key]) ? item.customFields[col.key] : "-");
                });
                customCols.forEach(function(col) { row.push((item.customFields && item.customFields[col]) ? item.customFields[col] : "-"); });
                tableRows.push(row);
            });

            doc.autoTable({ startY: y + 15, head: [tableColumn], body: tableRows, theme: 'striped', headStyles: { fillColor: [79, 70, 229] }, styles: { fontSize: 9 } });

            const totalsEl = document.getElementById("ui-total");
            const totalsData = totalsEl ? totalsEl.dataset : { gross: "0", discount: "0", tax: "0", rawtotal: "0" };
            let currentY = doc.lastAutoTable.finalY + 12;

            doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text(`Subtotal: Rs. ${totalsData.gross}`, 135, currentY); currentY += 6; doc.text(`Discount: Rs. ${totalsData.discount}`, 135, currentY); currentY += 6;
            // ✅ Dynamic Multi-Tier Tax Loop for A4/A5 PDFs
            if (window.currentCartTaxDetails && window.currentCartTaxDetails.length > 0) {
                window.currentCartTaxDetails.forEach(t => {
                    doc.text(`${t.name} (${t.rate}%): Rs. ${t.amount.toFixed(2)}`, 135, currentY); 
                    currentY += 6;
                });
            } else if (parseFloat(totalsData.tax) > 0) { 
                doc.text(`Tax: Rs. ${totalsData.tax}`, 135, currentY); 
                currentY += 6; 
            }
            doc.setFontSize(14); doc.setTextColor(16, 185, 129); doc.text(`Grand Total: Rs. ${totalsData.rawtotal}`, 135, currentY + 4);
        }

        if (outputType === 'base64') return doc.output('datauristring');
        else if (outputType === 'print') { doc.autoPrint(); window.open(doc.output('bloburl'), '_blank'); return true; }
        else { doc.save(`Invoice_${Date.now()}.pdf`); return true; }
    };

    window.downloadPDF = function() { if(typeof window.generateInvoicePDF === "function") window.generateInvoicePDF('download'); };

    // ✅ FIXED: Bulletproof WhatsApp trigger
    window.sendWhatsAppReceipt = async function() {
        if (!window.cart || window.cart.length === 0) return;
        const phoneInput = document.getElementById("cust-phone");
        const phone = phoneInput ? phoneInput.value.trim() : "";
        if (!phone) { 
            if(window.showToast) window.showToast("Please enter a customer WhatsApp number.", "error"); 
            return; 
        }

        const totalsEl = document.getElementById("ui-total");
        const rawTotal = totalsEl ? totalsEl.dataset.rawtotal : "0";

        const bp = window.currentSettings && window.currentSettings.businessProfile ? window.currentSettings.businessProfile : {};
        let message = `Hello from ${bp.name || "Our Shop"}!\n\nHere are your bill details:\n`;
        window.cart.forEach(function(item) { message += `- ${item.name} x${item.qty}: ₹${((item.price * item.qty) - (item.discount || 0)).toFixed(2)}\n`; });
        message += `\nGrand Total: ₹${rawTotal}\n\nThank you for your visit!`;

        const prefs = window.currentSettings && window.currentSettings.globalPrefs ? window.currentSettings.globalPrefs : {};
        const waFormat = prefs.waFormat || 'a4';

        let pdfBase64 = null;
        if (waFormat !== 'text') {
            if(typeof window.generateInvoicePDF === "function") {
                try {
                    pdfBase64 = window.generateInvoicePDF('base64', waFormat);
                } catch(e) {
                    console.warn("Could not generate PDF, falling back to text only.", e);
                }
            }
            // ❌ Removed the "if (!pdfBase64) return;" so it ALWAYS sends the text message even if PDF fails!
        }

        try {
            if(window.showToast) window.showToast(`Sending receipt to WhatsApp...`, "success");
            const res = await window.fetchAPI('/whatsapp/send', 'POST', { phone: phone, message: message, pdfBase64: pdfBase64 });
            if(window.showToast) window.showToast(res.message, "success");
        } catch (err) {
            if(err.message !== "LICENSE_EXPIRED" && window.showToast) window.showToast("WhatsApp failed: " + err.message, "error");
        }
    };
})();;

;(function() {
    window.renderSalesTable = function(data, pageData) {
        const tbody = document.getElementById("sales-table");
        if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">No sales records found.</td></tr>`; return; }
        
        tbody.innerHTML = data.map(inv => {
            const isSettlement = inv.isSettlement || inv.id.startsWith('RCPT') || inv.id.startsWith('CRN');
            let badge = '';
            if (isSettlement) {
                badge = inv.id.startsWith('CRN') 
                    ? `<span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 10px; margin-left: 10px; font-weight: bold;">CREDIT NOTE</span>`
                    : `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 4px; font-size: 10px; margin-left: 10px; font-weight: bold;">RECEIPT</span>`;
            }
            return `<tr><td><button onclick="window.viewInvoiceModal('${inv.id}')" style="background:none; border:none; color:var(--primary); font-weight:600; cursor:pointer; padding:0; text-decoration:underline;">${inv.id}</button>${badge}</td><td style="color:var(--text-muted);">${new Date(inv.date).toLocaleString()}</td><td style="font-weight:500;">${window.escapeHTML(inv.customerName) || 'Walk-in'}</td><td><span style="background: #e2e8f0; color: var(--text-main); padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;">${window.escapeHTML(inv.cashier)}</span></td><td style="font-weight: 700; color: var(--success);">₹${parseFloat(inv.grandTotal).toFixed(2)}</td></tr>`;
        }).join('');
        
        if(pageData) {
            const paginationHTML = `<tr><td colspan="5" style="text-align: center; padding: 15px; border:none;"><button class="btn-primary" onclick="window.fetchSalesHistory(${pageData.currentPage - 1})" ${pageData.currentPage === 1 ? 'disabled' : ''} style="padding: 5px 10px; margin-right: 10px; font-size:12px;">⬅️ Previous</button><span style="font-weight:600; font-size:13px;">Page ${pageData.currentPage} of ${pageData.totalPages || 1}</span><button class="btn-primary" onclick="window.fetchSalesHistory(${pageData.currentPage + 1})" ${pageData.currentPage === pageData.totalPages || pageData.totalPages === 0 ? 'disabled' : ''} style="padding: 5px 10px; margin-left: 10px; font-size:12px;">Next ➡️</button></td></tr>`;
            tbody.insertAdjacentHTML('beforeend', paginationHTML);
        }
    };

    window.fetchSalesHistory = async function(page = 1) {
        try {
            window.currentSalesPage = page;
            const data = await window.fetchAPI(`/invoices?page=${page}&limit=10`);
            window.salesHistoryList = data.invoices;
            window.renderSalesTable(window.salesHistoryList, data);
        } catch (err) { console.error("Failed to fetch sales:", err); }
    };

    window.filterSales = function() { 
        const query = document.getElementById("search-invoice").value.toLowerCase(); 
        window.renderSalesTable((window.salesHistoryList||[]).filter(inv => inv.id.toLowerCase().includes(query))); 
    };

    window.viewInvoiceModal = function(id) {
        const inv = (window.salesHistoryList||[]).find(i => i.id === id); if(!inv) return;
        const isSettlement = inv.isSettlement || inv.id.startsWith('RCPT') || inv.id.startsWith('CRN');
        
        const titleEl = document.getElementById("modal-inv-id");
        if (inv.id.startsWith('RCPT')) { titleEl.innerText = "Payment Receipt: " + inv.id; titleEl.style.color = "#166534"; } 
        else if (inv.id.startsWith('CRN')) { titleEl.innerText = "Credit Note: " + inv.id; titleEl.style.color = "#991b1b"; } 
        else { titleEl.innerText = "Tax Invoice: " + inv.id; titleEl.style.color = "var(--primary)"; }

        document.getElementById("modal-inv-date").innerText = new Date(inv.date).toLocaleString(); 
        document.getElementById("modal-inv-cashier").innerText = inv.cashier; 
        document.getElementById("modal-inv-customer").innerText = inv.customerName || "Walk-in"; 
        document.getElementById("modal-inv-phone").innerText = inv.phone || "N/A";
        
        document.getElementById("modal-inv-items").innerHTML = inv.items.map(item => `<tr><td style="font-weight:500;">${window.escapeHTML(item.name)}</td><td>${item.qty}</td><td>₹${item.price.toFixed(2)}</td><td style="color:var(--danger);">₹${(item.discount || 0).toFixed(2)}</td><td style="font-weight:600;">₹${item.total.toFixed(2)}</td></tr>`).join('');
        
        const subRow = document.getElementById("modal-inv-sub").parentElement;
        const discRow = document.getElementById("modal-inv-discount").parentElement;
        const grandTotalH3 = document.getElementById("modal-inv-total").parentElement;
        const profitRow = document.getElementById("modal-inv-profit-row");

        if (isSettlement) {
            subRow.style.display = "none"; discRow.style.display = "none"; grandTotalH3.style.display = "none"; profitRow.style.display = "none";
            document.getElementById("modal-inv-gst-row").style.display = "none"; 
        } else {
            subRow.style.display = "block"; discRow.style.display = "block"; grandTotalH3.style.display = "block";
            document.getElementById("modal-inv-sub").innerText = `₹${inv.subtotal.toFixed(2)}`; 
            document.getElementById("modal-inv-discount").innerText = `- ₹${inv.discount.toFixed(2)}`;
            document.getElementById("modal-inv-total").innerText = `₹${inv.grandTotal.toFixed(2)}`;
            
            if (inv.taxAmount > 0) { 
                document.getElementById("modal-inv-gst-row").style.display = "block"; 
                document.getElementById("modal-inv-gst").innerText = `+ ₹${inv.taxAmount.toFixed(2)}`; 
            } else { document.getElementById("modal-inv-gst-row").style.display = "none"; }
            
            if (window.storage.get("role") === "admin") { 
                profitRow.style.display = "block"; document.getElementById("modal-inv-profit").innerText = `₹${(inv.totalProfit || 0).toFixed(2)}`; 
            } else { profitRow.style.display = "none"; }
        }

        const p = inv.payments || { cash:0, upi:0, card:0, wallet:0, loyalty:0, creditDue:0 };
        let payHtml = '';
        
        // 🚀 FIX: Use Math.abs() so refunds and settlements always show as positive amounts in the UI breakdown
        if (p.cash !== 0) payHtml += `<div style="margin-bottom: 4px;"><span style="color:var(--text-muted);">💵 Cash:</span> <span style="font-weight: 500; display: inline-block; width: 120px;">₹${Math.abs(p.cash).toFixed(2)}</span></div>`;
        if (p.upi !== 0) payHtml += `<div style="margin-bottom: 4px;"><span style="color:var(--text-muted);">📱 UPI:</span> <span style="font-weight: 500; display: inline-block; width: 120px;">₹${Math.abs(p.upi).toFixed(2)}</span></div>`;
        if (p.card !== 0) payHtml += `<div style="margin-bottom: 4px;"><span style="color:var(--text-muted);">💳 Card:</span> <span style="font-weight: 500; display: inline-block; width: 120px;">₹${Math.abs(p.card).toFixed(2)}</span></div>`;
        if (p.wallet !== 0) payHtml += `<div style="margin-bottom: 4px;"><span style="color:var(--text-muted);">💼 Wallet:</span> <span style="font-weight: 500; display: inline-block; width: 120px;">₹${Math.abs(p.wallet).toFixed(2)}</span></div>`;
        if (p.loyalty !== 0) payHtml += `<div style="margin-bottom: 4px;"><span style="color:var(--text-muted);">🎁 Loyalty:</span> <span style="font-weight: 500; display: inline-block; width: 120px;">₹${Math.abs(p.loyalty).toFixed(2)}</span></div>`;
        
        const totalPaid = Math.abs(p.cash||0) + Math.abs(p.upi||0) + Math.abs(p.card||0) + Math.abs(p.wallet||0) + Math.abs(p.loyalty||0);
        if (totalPaid !== 0 || p.creditDue !== 0) payHtml += `<div style="margin-top: 8px; font-weight: 600;"><span style="color:var(--text-main);">Total Paid / Adjusted:</span> <span style="display: inline-block; width: 120px;">₹${totalPaid.toFixed(2)}</span></div>`;

        if (inv.settlements && inv.settlements.length > 0) {
            payHtml += `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px;">`;
            payHtml += `<strong style="color:var(--primary); text-transform:uppercase;">Payment History</strong>`;
            inv.settlements.forEach(s => {
                payHtml += `<div style="display:flex; justify-content:space-between; color:var(--text-muted); margin-top:4px;">
                    <span>${new Date(s.date).toLocaleDateString()} (${s.method})</span>
                    <span style="color:var(--success); font-weight:bold;">+ ₹${s.amount.toFixed(2)}</span>
                </div>`;
            });
            payHtml += `</div>`;
        }

        // 🚀 FIX: IF THIS IS A RECEIPT/CREDIT NOTE, DO NOT SHOW "CHANGE RETURNED" OR BUTTONS!
        if (!isSettlement) {
            if (p.creditDue > 0) {
                payHtml += `<div style="margin-top: 10px; font-weight: 700; color: var(--danger);"><span style="color:var(--text-muted);">Balance Due (Khata):</span> <span style="display: inline-block; width: 120px;">₹${p.creditDue.toFixed(2)}</span></div>`;
                payHtml += `<button class="btn-primary" style="margin-top: 15px; width: 100%; background: var(--success);" onclick="window.settleInvoiceModal('${inv.id}', ${p.creditDue}, '${inv.customerName}', '${inv.phone}')">💳 Record Payment for this Invoice</button>`;
            } else if (p.creditDue < 0) {
                payHtml += `<div style="margin-top: 10px; font-weight: 700; color: var(--primary);"><span style="color:var(--text-muted);">Change Returned:</span> <span style="display: inline-block; width: 120px;">₹${Math.abs(p.creditDue).toFixed(2)}</span></div>`;
                payHtml += `<button class="btn-primary" style="margin-top: 15px; width: 100%; background: var(--danger);" onclick="window.settleInvoiceModal('${inv.id}', ${p.creditDue}, '${inv.customerName}', '${inv.phone}')">💵 Process Refund for this Invoice</button>`;
            } else if (inv.settlements && inv.settlements.length > 0) {
                payHtml += `<div style="margin-top: 10px; font-weight: 700; color: var(--success); text-align:center;">✅ Fully Settled</div>`;
            }
        } else {
            // It IS a settlement, just show a happy checkmark!
            payHtml += `<div style="margin-top: 10px; font-weight: 700; color: var(--success); text-align:center;">✅ Account Adjusted Successfully</div>`;
        }

        const payContainer = document.getElementById("modal-inv-payment-info");
        if (payContainer) { payContainer.innerHTML = payHtml; payContainer.style.display = payHtml ? "block" : "none"; }

        document.getElementById("invoiceModal").style.display = "flex";
    };

    window.settleInvoiceModal = async function(invId, currentBalance, customerName, phone) {
        const isOwed = currentBalance > 0;
        const actionText = isOwed ? "Payment Received" : "Refund Given";
        
        const amtStr = prompt(`Recording payment for ${invId}\nCurrent Balance: ₹${Math.abs(currentBalance).toFixed(2)}\n\nEnter ${actionText} Amount:`);
        if (!amtStr) return; 
        
        const amt = parseFloat(amtStr);
        if (isNaN(amt) || amt <= 0) return alert("Please enter a valid amount.");
        if (amt > Math.abs(currentBalance)) return alert("Amount cannot be greater than the outstanding balance.");

        const method = prompt("Payment Method? (Type: cash, upi, or card)", "cash");
        if (!method) return;

        try {
            const res = await window.fetchAPI('/invoices/settle', 'POST', {
                originalInvoiceId: invId,
                amount: amt,
                payMethod: method.toLowerCase(),
                customerName: customerName,
                phone: phone
            });

            if (window.showToast) window.showToast(res.message, "success");
            
            if (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.enableWhatsapp && phone) {
                const bpName = window.currentSettings.businessProfile?.name || "Our Shop";
                let msg = `Hello ${customerName}, from ${bpName}!\n\n`;
                msg += `🧾 *${actionText}*\n`;
                msg += `Amount: ₹${amt.toFixed(2)} (${method})\n`;
                msg += `Applied to Invoice: ${invId}\n`;
                msg += `Voucher ID: ${res.receiptId}\n\n`;
                msg += `New Invoice Balance: ₹${res.newBalance.toFixed(2)}\n`;
                msg += `Thank you!`;
                
                try {
                    if(window.showToast) window.showToast(`Sending WhatsApp Notification...`, "success");
                    await window.fetchAPI('/whatsapp/send', 'POST', { phone: phone, message: msg, pdfBase64: null });
                } catch(e) {}
            }

            document.getElementById("invoiceModal").style.display = "none";
            window.fetchSalesHistory(window.currentSalesPage);
            if(window.fetchCreditLedger) window.fetchCreditLedger();
            if(window.fetchCustomers) window.fetchCustomers();
            if(window.fetchDashboardStats) window.fetchDashboardStats();
        } catch (err) {
            alert("Failed to settle invoice: " + err.message);
        }
    };

    window.closeInvoiceModal = function() { document.getElementById("invoiceModal").style.display = "none"; };
})();;

;(function() {
    window.fetchCustomers = async function() {
        try {
            window.allCustomersData = await window.fetchAPI('/customers');
            const tbody = document.getElementById("customers-table");
            
            if(tbody) {
                if (!window.allCustomersData || window.allCustomersData.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">No customers found.</td></tr>`;
                    return;
                }

                let htmlStr = "";
                window.allCustomersData.forEach(function(c) {
                    const spent = parseFloat(c.totalSpent) || 0;
                    const credit = parseFloat(c.creditDue) || 0;
                    const loyalty = parseInt(c.loyaltyPoints) || 0;
                    const lastVisit = c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : "N/A";

                    htmlStr += `
                    <tr>
                        <td style="font-weight:600;">${window.escapeHTML(c.name || 'Unknown')}</td>
                        <td>${window.escapeHTML(c.phone || 'N/A')}</td>
                        <td style="font-weight:bold; color:var(--success);">₹${spent.toFixed(2)}</td>
                        <td>${loyalty} pts</td>
                        <td style="font-weight:bold; color:var(--danger);">₹${credit.toFixed(2)}</td>
                        <td style="color:var(--text-muted);">${lastVisit}</td>
                    </tr>
                    `;
                });
                tbody.innerHTML = htmlStr;
            }
        } catch(err) {
            console.error("CRM Fetch Error:", err);
        }
    };
})();;

;(function() {
    window.fetchExpenses = async function() {
        try {
            const expenses = await window.fetchAPI('/expenses');
            const tbody = document.getElementById('expenses-table');
            if(!tbody) return;
            if(expenses.length === 0) return tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No expenses logged yet.</td></tr>`;
            tbody.innerHTML = expenses.sort((a,b) => new Date(b.date) - new Date(a.date)).map(e => `<tr><td style="color:var(--text-muted);">${new Date(e.date).toLocaleDateString()}</td><td style="font-weight:600;">${window.escapeHTML(e.category)}</td><td>${window.escapeHTML(e.description) || '-'}</td><td style="font-weight:600; color:var(--danger);">₹${e.amount.toFixed(2)}</td><td><span style="background: #e2e8f0; padding: 4px 10px; border-radius: 20px; font-size: 11px;">${e.loggedBy}</span></td></tr>`).join('');
        } catch(e) {}
    };

    window.addExpense = async function() {
        const category = document.getElementById("exp-cat").value;
        const description = document.getElementById("exp-desc").value.trim();
        const amount = document.getElementById("exp-amt").value;
        if (!amount || amount <= 0) return window.showToast("Enter a valid positive amount.", "error");
        try {
            await window.fetchAPI('/expenses', 'POST', { category, description, amount });
            window.showToast("Expense logged securely!", "success");
            document.getElementById("exp-desc").value = ""; document.getElementById("exp-amt").value = "";
            window.fetchExpenses(); 
            if(window.fetchDashboardStats) window.fetchDashboardStats();
        } catch(e) { if(e.message !== "LICENSE_EXPIRED") window.showToast(e.message, "error"); }
    };
})();;

async function fetchDashboardStats() {
    try {
        const [stats, inventory, invoices] = await Promise.all([ fetchAPI('/stats'), fetchAPI('/inventory'), fetchAPI('/invoices?limit=5000') ]);
        document.getElementById("stat-sales").innerText = `₹${stats.totalSales.toFixed(2)}`;
        document.getElementById("stat-exp").innerText = `₹${stats.totalExpenses.toFixed(2)}`; 
        document.getElementById("stat-profit").innerText = `₹${stats.totalProfit.toFixed(2)}`; 
        document.getElementById("stat-invoices").innerText = stats.totalInvoices;
        document.getElementById("stat-stock").innerText = stats.lowStockCount;

        const tbody = document.getElementById("dashboard-recent");
        if (stats.recentTransactions.length === 0) { tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No recent transactions.</td></tr>`; } 
        else { tbody.innerHTML = stats.recentTransactions.map(inv => `<tr><td style="color:var(--primary); font-weight:500;">${inv.id}</td><td>${new Date(inv.date).toLocaleDateString()}</td><td style="color:var(--success); font-weight:600;">₹${inv.grandTotal.toFixed(2)}</td></tr>`).join(''); }

        let serviceCount = 0; let productCount = 0; const invList = invoices.invoices || invoices;
        invList.forEach(invoice => invoice.items.forEach(item => { 
            const invItem = inventory.find(p => p.id === item.id || p.name === item.name);
            if (invItem && invItem.category && invItem.category.toLowerCase().includes('service')) serviceCount += item.qty; else productCount += item.qty;
        }));

        const chartContainer = document.getElementById('dashboardChart');
        if (chartContainer) {
            if (typeof Chart !== 'undefined') {
                if (myChart) myChart.destroy(); 
                myChart = new Chart(chartContainer, { type: 'bar', data: { labels: ['Products Sold', 'Services Provided'], datasets: [{ label: 'Quantity', data: [productCount, serviceCount], backgroundColor: ['#4f46e5', '#10b981'], borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
            } else { chartContainer.parentElement.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted); border: 2px dashed var(--border); border-radius: 8px;">📊 <b>Analytics Blocked</b><br><br>Your browser's Tracking Prevention is blocking the chart library.<br>Disable Strict Prevention to view charts.</div>`; }
        }
    } catch (err) { }
}

(function() {
    window.generateReport = async function(type) {
        document.getElementById("report-period-header").innerText = type === 'all' ? 'Invoice ID' : 'Period';
        try {
            const data = await window.fetchAPI('/invoices?limit=100000'); 
            const invoices = data.invoices || []; 
            const tbody = document.getElementById("reports-table");
            if (invoices.length === 0) return tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 30px; color: var(--text-muted);">No records found.</td></tr>`;
            
            if (type === 'all') { 
                tbody.innerHTML = invoices.map(i => `<tr><td style="font-weight:600; color:var(--primary);">${i.id}</td><td>1</td><td style="color:var(--success); font-weight:700;">₹${i.grandTotal.toFixed(2)}</td><td style="color:#8b5cf6; font-weight:700;">₹${(i.totalProfit||0).toFixed(2)}</td></tr>`).join(''); 
                return; 
            }
            
            const groups = {};
            invoices.forEach(inv => {
                const date = new Date(inv.date); let key;
                if (type === 'daily') key = date.toLocaleDateString(); 
                else if (type === 'monthly') key = `${date.toLocaleString('default', { month: 'long' })} ${date.getFullYear()}`; 
                else if (type === 'yearly') key = date.getFullYear().toString(); 
                else if (type === 'weekly') { 
                    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); 
                    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); 
                    const weekNo = Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(),0,1))) / 86400000) + 1)/7); 
                    key = `${d.getUTCFullYear()} - Week ${weekNo}`; 
                }
                if (!groups[key]) groups[key] = { count: 0, total: 0, profit: 0 }; 
                groups[key].count += 1; 
                groups[key].total += inv.grandTotal; 
                groups[key].profit += (inv.totalProfit || 0);
            });
            
            tbody.innerHTML = Object.keys(groups).map(k => `<tr><td style="font-weight:600;">${k}</td><td>${groups[k].count}</td><td style="color:var(--success); font-weight:700;">₹${groups[k].total.toFixed(2)}</td><td style="color:#8b5cf6; font-weight:700;">₹${groups[k].profit.toFixed(2)}</td></tr>`).join('');
        } catch(e) {}
    }
})();;

;(function() {
    window.toggleWaOptions = function() {
        const waEl = document.getElementById("set-wa-enable");
        const isEnabled = waEl ? waEl.checked : false;
        const subOpts = document.getElementById("wa-sub-options");
        if(subOpts) subOpts.style.display = isEnabled ? "flex" : "none";
        
        const checkoutBtn = document.getElementById("checkoutBtn");
        const autoEl = document.getElementById("set-wa-auto");
        const isAutoSend = autoEl ? autoEl.checked : false;
        
        const btnEl = document.getElementById("set-wa-btn");
        const isShowBtn = btnEl ? btnEl.checked : false;
        
        if (checkoutBtn) {
            if (isEnabled && isAutoSend) { checkoutBtn.innerHTML = "💾 Complete Checkout & Send 💬"; checkoutBtn.style.background = "#059669"; } 
            else { checkoutBtn.innerHTML = "💾 Complete Checkout"; checkoutBtn.style.background = "var(--success)"; }
        }
        const waBtn = document.getElementById("btn-wa-send");
        if (waBtn) { waBtn.style.display = (isEnabled && isShowBtn) ? "block" : "none"; }
    };

    window.toggleCloudOptions = function() { 
        const cloudEnable = document.getElementById("set-cloud-enable");
        const subOpts = document.getElementById("cloud-sub-options");
        if(subOpts && cloudEnable) subOpts.style.display = cloudEnable.checked ? "flex" : "none"; 
    };

    window.togglePrinterOptions = function() {
        const formatEl = document.getElementById("set-print-format");
        const format = formatEl ? formatEl.value : "thermal";
        const widthOpts = document.getElementById("printer-width-options");
        if(widthOpts) widthOpts.style.display = (format === 'thermal' || format === 'barcode') ? "block" : "none";
    };
	
	window.renderTaxRulesTable = function() {
        const tbody = document.getElementById("tax-rules-table");
        if (!tbody) return;
        
        const rules = window.currentSettings.globalPrefs.taxRules;
        if (!rules || rules.length === 0) {
            return tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No tax rules defined. Add one below.</td></tr>`;
        }
        
        tbody.innerHTML = rules.map((tax, index) => 
            `<tr>
                <td style="font-weight:600; color:var(--text-main);">${window.escapeHTML(tax.name)}</td>
                <td style="font-weight:500;">${tax.rate}%</td>
                <td style="text-align:right;">
                    <button type="button" class="btn-danger" style="padding: 6px 10px;" onclick="window.removeTaxRule(${index})">✕</button>
                </td>
            </tr>`
        ).join('');
    };

    window.addTaxRule = function() {
        const nameInput = document.getElementById("new-tax-name");
        const rateInput = document.getElementById("new-tax-rate");
        const name = nameInput ? nameInput.value.trim() : "";
        const rate = rateInput ? parseFloat(rateInput.value) : 0;

        if (!name || isNaN(rate) || rate <= 0) {
            return window.showToast("Please enter a valid Tax Name and positive Rate.", "error");
        }

        if (!window.currentSettings.globalPrefs.taxRules) {
            window.currentSettings.globalPrefs.taxRules = [];
        }
        
        window.currentSettings.globalPrefs.taxRules.push({ name, rate });
        
        if (nameInput) nameInput.value = "";
        if (rateInput) rateInput.value = "";
        
        window.renderTaxRulesTable();
        if (window.renderCart) window.renderCart(); // Instantly update the cart if they are testing!
    };

    window.removeTaxRule = function(index) {
        if (window.currentSettings.globalPrefs.taxRules) {
            window.currentSettings.globalPrefs.taxRules.splice(index, 1);
        }
        window.renderTaxRulesTable();
        if (window.renderCart) window.renderCart();
    };
	

    window.fetchSettings = async function() {
        try {
            window.currentSettings = await window.fetchAPI('/settings');
            try { 
                const realLicense = await window.fetchAPI('/check-license'); 
                const licenseData = realLicense.data || realLicense;
                window.currentSettings.subscription = { 
                    validUntil: licenseData.validUntil || realLicense.validUntil,
                    planType: licenseData.planType || 'basic',
                    maxUsers: licenseData.maxUsers || 3,
                    clientId: licenseData.clientId || 'Legacy Profile'
                }; 
            } catch(e) {}

            window.populateSettingsUI();
            const nextVisitContainer = document.getElementById("next-visit-container");
            if (nextVisitContainer && window.currentSettings && window.currentSettings.globalPrefs) {
                nextVisitContainer.style.display = window.currentSettings.globalPrefs.enableNextVisit ? "block" : "none";
            }
            
            if (window.fetchDashboardStats) window.fetchDashboardStats(); 
            if (window.fetchInventory) window.fetchInventory(); 
            if (window.storage.get('role') === 'admin' && window.fetchUsers) window.fetchUsers();
			if(document.getElementById("set-currency")) document.getElementById("set-currency").value = window.currentSettings.globalPrefs.currencySymbol || "₹";
			if(document.getElementById("set-timezone")) document.getElementById("set-timezone").value = window.currentSettings.globalPrefs.timezone || "Asia/Kolkata";
        } catch (err) { }
    };

    window.populateSettingsUI = function() {
        if (!window.currentSettings) return;
        const role = window.storage.get("role");
        
        if (role !== "admin") {
            const toggle = (id, perm) => { const el = document.getElementById(id); if (el) el.style.display = window.userPerms.includes(perm) ? "block" : "none"; };
            ['dash', 'inv', 'bill', 'sales', 'customers', 'expenses', 'reports'].forEach(p => { const navId = p === 'inv' ? 'nav-inv' : p === 'bill' ? 'nav-bill' : `nav-${p}`; const navEl = document.getElementById(navId); if(navEl) navEl.style.display = window.userPerms.includes(p) ? "block" : "none"; });
            
            const navCredit = document.getElementById('nav-credit');
            if (navCredit) navCredit.style.display = window.userPerms.includes('customers') ? "block" : "none";

            toggle("card-profile", "set_profile"); toggle("card-logo", "set_profile"); toggle("card-custom-cols", "set_columns"); toggle("card-pdf-cols", "set_columns"); toggle("card-prefs", "set_prefs"); toggle("card-backup", "set_prefs"); toggle("card-users", "set_users");
        }

        if (window.currentSettings.subscription) {
            const plan = window.currentSettings.subscription.planType || 'basic';
            const navReports = document.getElementById('nav-reports');
            const navExpenses = document.getElementById('nav-expenses');
            const navCrm = document.getElementById('nav-customers');
            const navCredit = document.getElementById('nav-credit');
            const waEnableCheckbox = document.getElementById('set-wa-enable');

            if (plan === 'trial' || plan === 'basic') {
                if (navReports) navReports.style.display = 'none';
                if (navExpenses) navExpenses.style.display = 'none';
                if (navCrm) navCrm.style.display = 'none';
                if (navCredit) navCredit.style.display = 'none';
                if (waEnableCheckbox) {
                    waEnableCheckbox.disabled = true;
                    waEnableCheckbox.checked = false;
                    if (!waEnableCheckbox.parentElement.innerHTML.includes('Pro/Premium Required')) {
                        waEnableCheckbox.parentElement.innerHTML += ' <span style="color:var(--danger); font-size:11px; margin-left:8px;">(Pro/Premium Required)</span>';
                    }
                }
            } 
            // ✅ RESTORED BUSINESS RULE: PRO users do not get CRM/Khata!
            else if (plan === 'pro') {
                if (navCrm) navCrm.style.display = 'none';
                if (navCredit) navCredit.style.display = 'none';
            }
        }

        if (window.currentSettings.subscription && window.currentSettings.subscription.validUntil) {
            const expiryDate = new Date(window.currentSettings.subscription.validUntil); 
            const now = new Date();
            
            const subDisplay = document.getElementById("sub-date-display"); 
            const statusDisplay = document.getElementById("license-status-display"); 
            const expiryDetails = document.getElementById("license-expiry-display"); 
            const statusDot = document.getElementById("license-status-dot");
            
            const planName = window.currentSettings.subscription.planType ? window.currentSettings.subscription.planType.toUpperCase() : "BASIC";
            const clientId = window.currentSettings.subscription.clientId || "N/A";

            // Format precise expiry string (Date + Time)
            const exactExpiryStr = expiryDate.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            if (subDisplay) subDisplay.innerText = expiryDate.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            
            if (now > expiryDate) {
                if (subDisplay) subDisplay.style.color = "var(--danger)"; 
                if (statusDisplay) { statusDisplay.innerText = `Expired (${planName})`; statusDisplay.style.color = "var(--danger)"; } 
                if (statusDot) { statusDot.style.background = "var(--danger)"; statusDot.style.boxShadow = "0 0 8px var(--danger)"; } 
                if (expiryDetails) expiryDetails.innerText = `Identity: ${clientId} | Expired: ${exactExpiryStr}`;
            } else {
                if (subDisplay) subDisplay.style.color = "var(--success)"; 
                if (statusDisplay) { statusDisplay.innerText = `Active (${planName})`; statusDisplay.style.color = "var(--success)"; } 
                if (statusDot) { statusDot.style.background = "var(--success)"; statusDot.style.boxShadow = "0 0 8px var(--success)"; } 
                
                // ✅ PRECISION COUNTDOWN: Calculate Days, Hours, Minutes
                const diffMs = Math.max(0, expiryDate - now);
                const dDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                const dHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const dMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                
                let timeStr = "";
                if (dDays > 0) timeStr += `${dDays}d `;
                if (dHours > 0 || dDays > 0) timeStr += `${dHours}h `;
                timeStr += `${dMins}m remaining`;

                if (expiryDetails) expiryDetails.innerText = `Identity: ${clientId} | Exp: ${exactExpiryStr} (${timeStr})`;
            }
        }

        const bp = window.currentSettings.businessProfile || {};
        if(document.getElementById("set-shop-name")) document.getElementById("set-shop-name").value = bp.name || ""; 
        if(document.getElementById("set-tagline")) document.getElementById("set-tagline").value = bp.tagline || ""; 
        if(document.getElementById("set-addr1")) document.getElementById("set-addr1").value = bp.address1 || ""; 
        if(document.getElementById("set-addr2")) document.getElementById("set-addr2").value = bp.address2 || ""; 
        if(document.getElementById("set-phone")) document.getElementById("set-phone").value = bp.phone || ""; 
        if(document.getElementById("set-show-date")) document.getElementById("set-show-date").checked = bp.showDate || false; 
        if(document.getElementById("set-show-time")) document.getElementById("set-show-time").checked = bp.showTime || false;
        
        if (window.currentSettings.logoBase64) { 
            const logoPrev = document.getElementById("logoPreview");
            if(logoPrev) { logoPrev.src = window.currentSettings.logoBase64; logoPrev.style.display = "block"; }
        }
        
        if (window.currentSettings.globalPrefs) {
            if(document.getElementById("set-tax-type")) document.getElementById("set-tax-type").value = window.currentSettings.globalPrefs.taxType || "exclusive";
			if (!window.currentSettings.globalPrefs.taxRules) window.currentSettings.globalPrefs.taxRules = [];
			window.renderTaxRulesTable();
            if(document.getElementById("set-next-visit")) document.getElementById("set-next-visit").checked = window.currentSettings.globalPrefs.enableNextVisit || false;
            
            if(document.getElementById("set-wa-enable")) document.getElementById("set-wa-enable").checked = window.currentSettings.globalPrefs.enableWhatsapp || false; 
            if(document.getElementById("set-wa-btn")) document.getElementById("set-wa-btn").checked = window.currentSettings.globalPrefs.waShowButton || false; 
            if(document.getElementById("set-wa-auto")) document.getElementById("set-wa-auto").checked = window.currentSettings.globalPrefs.waAutoSend || false;
            if(document.getElementById("set-wa-format")) document.getElementById("set-wa-format").value = window.currentSettings.globalPrefs.waFormat || "a4";
            window.toggleWaOptions(); 

            if(document.getElementById("set-print-format")) document.getElementById("set-print-format").value = window.currentSettings.globalPrefs.printFormat || "thermal";
            if(document.getElementById("set-printer-width")) document.getElementById("set-printer-width").value = window.currentSettings.globalPrefs.printerWidth || "80mm";
            window.togglePrinterOptions();

            if(document.getElementById("set-cloud-enable")) document.getElementById("set-cloud-enable").checked = window.currentSettings.globalPrefs.enableCloud || false; 
            if(document.getElementById("cloud-provider")) document.getElementById("cloud-provider").value = window.currentSettings.globalPrefs.cloudProvider || "aws_s3"; 
            if(document.getElementById("cloud-endpoint")) document.getElementById("cloud-endpoint").value = window.currentSettings.globalPrefs.cloudEndpoint || ""; 
            if(document.getElementById("cloud-bucket")) document.getElementById("cloud-bucket").value = window.currentSettings.globalPrefs.cloudBucket || ""; 
            if(document.getElementById("cloud-key")) document.getElementById("cloud-key").value = window.currentSettings.globalPrefs.cloudKey || ""; 
            if(document.getElementById("cloud-secret")) document.getElementById("cloud-secret").value = window.currentSettings.globalPrefs.cloudSecret || "";
            window.toggleCloudOptions();

            if (window.currentSettings.pdfColumns) {
                const globalDiscountSetting = window.currentSettings.pdfColumns.find(c => c.key === 'discount');
                if (globalDiscountSetting && document.getElementById("bill-show-discount-col")) { 
                    document.getElementById("bill-show-discount-col").checked = globalDiscountSetting.show; 
                }
            }
            
            window.renderPdfColsTable(); 
            if (window.currentSettings.customColumns) window.renderCustomColsTable();
        }
    };

    window.renewSubscription = function() { 
        const clientId = window.currentSettings?.subscription?.clientId || 'Unknown';
        const yourPhone = "919876543210"; 
        const message = encodeURIComponent(`Hello! My Client ID is *${clientId}*. I would like to renew my Baraka POS software subscription.`);
        window.open(`https://wa.me/${yourPhone}?text=${message}`, '_blank');
    };

    window.requestPlanChange = function() {
        const currentPlan = window.currentSettings?.subscription?.planType || 'basic';
        const clientId = window.currentSettings?.subscription?.clientId || 'Unknown';
        
        const targetPlan = prompt(`Current Plan: ${currentPlan.toUpperCase()}\n\nWhich plan would you like to switch to?\n(Type: BASIC, PRO, or PREMIUM)`);
        if (!targetPlan) return; 
        
        const normalizedPlan = targetPlan.trim().toUpperCase();
        if (!['BASIC', 'PRO', 'PREMIUM'].includes(normalizedPlan)) {
            return alert("❌ Invalid plan. Please try again and type BASIC, PRO, or PREMIUM.");
        }

        if (normalizedPlan === currentPlan.toUpperCase()) {
            return alert("You are already on the " + normalizedPlan + " plan!");
        }
        
        const yourPhone = "919876543210"; 
        const message = encodeURIComponent(`Hello! My Client ID is *${clientId}*. \n\nI would like to change my POS software plan from ${currentPlan.toUpperCase()} to *${normalizedPlan}*. \n\nPlease let me know the process!`);
        window.open(`https://wa.me/${yourPhone}?text=${message}`, '_blank');
    };

    window.renderCustomColsTable = function() { 
        const tbody = document.getElementById("custom-cols-table"); 
        if(!tbody) return; 
        if (!window.currentSettings.customColumns || window.currentSettings.customColumns.length === 0) return tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">No custom fields defined.</td></tr>`; 
        tbody.innerHTML = window.currentSettings.customColumns.map((col, index) => `<tr><td style="font-weight:500;">${window.escapeHTML(col)}</td><td><button class="btn-danger" onclick="window.removeCustomColumn(${index})">Remove</button></td></tr>`).join(''); 
    };

    window.addCustomColumn = function() { 
        const input = document.getElementById("new-custom-col"); 
        if (input && input.value.trim()) { 
            if(!window.currentSettings.customColumns) window.currentSettings.customColumns = [];
            window.currentSettings.customColumns.push(input.value.trim()); 
            input.value = ""; 
            window.renderCustomColsTable(); 
            if(window.renderCart) window.renderCart(); 
        } 
    };

    window.removeCustomColumn = function(index) { 
        if(window.currentSettings.customColumns) window.currentSettings.customColumns.splice(index, 1); 
        window.renderCustomColsTable(); 
        if(window.renderCart) window.renderCart(); 
    };

    window.renderPdfColsTable = function() { 
        const tbody = document.getElementById("pdf-cols-table"); 
        if(!tbody) return; 
        if(!window.currentSettings.pdfColumns) return;
        tbody.innerHTML = window.currentSettings.pdfColumns.map((col, index) => `<tr><td style="font-weight: 500; color: var(--primary);">${window.escapeHTML(col.key)}</td><td><input type="text" style="width: 140px; padding: 8px;" value="${col.label}" onchange="window.currentSettings.pdfColumns[${index}].label = this.value; window.renderCart();"></td><td style="text-align: center;"><input type="checkbox" style="width:18px; height:18px; accent-color:var(--primary);" ${col.show ? 'checked' : ''} onchange="window.currentSettings.pdfColumns[${index}].show = this.checked; window.renderCart();"></td><td style="display: flex; gap: 4px;"><button class="btn-primary" style="padding: 6px; background: #94a3b8; box-shadow: none;" onclick="window.movePdfCol(${index}, -1)" title="Move Left/Up" ${index === 0 ? 'disabled' : ''}>⬆️</button><button class="btn-primary" style="padding: 6px; background: #94a3b8; box-shadow: none;" onclick="window.movePdfCol(${index}, 1)" title="Move Right/Down" ${index === window.currentSettings.pdfColumns.length - 1 ? 'disabled' : ''}>⬇️</button><button class="btn-danger" style="padding: 6px 10px;" onclick="window.removeStandardColumn(${index})" title="Remove Column">✕</button></td></tr>`).join(''); 
    };

    window.movePdfCol = function(index, direction) { 
        if (!window.currentSettings.pdfColumns || index + direction < 0 || index + direction >= window.currentSettings.pdfColumns.length) return; 
        const temp = window.currentSettings.pdfColumns[index]; 
        window.currentSettings.pdfColumns[index] = window.currentSettings.pdfColumns[index + direction]; 
        window.currentSettings.pdfColumns[index + direction] = temp; 
        window.renderPdfColsTable(); 
        if(window.renderCart) window.renderCart(); 
    };

    window.addStandardColumn = function() { 
        const keyEl = document.getElementById("new-pdf-key");
        const labelEl = document.getElementById("new-pdf-label");
        const key = keyEl ? keyEl.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') : ""; 
        const label = labelEl ? labelEl.value.trim() : ""; 
        if (!key || !label) return window.showToast("Please enter both Key and Label.", "error"); 
        if (!window.currentSettings.pdfColumns) window.currentSettings.pdfColumns = [];
        if (window.currentSettings.pdfColumns.some(c => c.key === key)) return window.showToast("Column key already exists.", "error"); 
        window.currentSettings.pdfColumns.push({ key, label, show: true }); 
        if(keyEl) keyEl.value = ""; 
        if(labelEl) labelEl.value = ""; 
        window.renderPdfColsTable(); 
        if(window.renderCart) window.renderCart(); 
    };

    window.removeStandardColumn = function(index) { 
        if(window.currentSettings.pdfColumns) window.currentSettings.pdfColumns.splice(index, 1); 
        window.renderPdfColsTable(); 
        if(window.renderCart) window.renderCart(); 
    };

    window.saveSettings = async function() {
        if (!window.currentSettings) window.currentSettings = {};
        
        window.currentSettings.businessProfile = { 
            name: document.getElementById("set-shop-name") ? document.getElementById("set-shop-name").value : "", 
            tagline: document.getElementById("set-tagline") ? document.getElementById("set-tagline").value : "", 
            address1: document.getElementById("set-addr1") ? document.getElementById("set-addr1").value : "", 
            address2: document.getElementById("set-addr2") ? document.getElementById("set-addr2").value : "", 
            phone: document.getElementById("set-phone") ? document.getElementById("set-phone").value : "", 
            showDate: document.getElementById("set-show-date") ? document.getElementById("set-show-date").checked : false, 
            showTime: document.getElementById("set-show-time") ? document.getElementById("set-show-time").checked : false 
        };

        window.currentSettings.globalPrefs = { 
            enableGst: document.getElementById("set-tax-enable") ? document.getElementById("set-tax-enable").checked : false, 
            enableNextVisit: document.getElementById("set-next-visit") ? document.getElementById("set-next-visit").checked : false, 
			
			currencySymbol: document.getElementById("set-currency") ? document.getElementById("set-currency").value : "₹",
			timezone: document.getElementById("set-timezone") ? document.getElementById("set-timezone").value : "Asia/Kolkata",
            
            enableWhatsapp: document.getElementById("set-wa-enable") ? document.getElementById("set-wa-enable").checked : false, 
            waShowButton: document.getElementById("set-wa-btn") ? document.getElementById("set-wa-btn").checked : false, 
            waAutoSend: document.getElementById("set-wa-auto") ? document.getElementById("set-wa-auto").checked : false, 
            waFormat: document.getElementById("set-wa-format") ? document.getElementById("set-wa-format").value : "a4",
            
            printFormat: document.getElementById("set-print-format") ? document.getElementById("set-print-format").value : "thermal", 
            printerWidth: document.getElementById("set-printer-width") ? document.getElementById("set-printer-width").value : "80mm", 
            
            enableCloud: document.getElementById("set-cloud-enable") ? document.getElementById("set-cloud-enable").checked : false, 
            cloudProvider: document.getElementById("cloud-provider") ? document.getElementById("cloud-provider").value : "aws_s3", 
            cloudEndpoint: document.getElementById("cloud-endpoint") ? document.getElementById("cloud-endpoint").value.trim() : "", 
            cloudBucket: document.getElementById("cloud-bucket") ? document.getElementById("cloud-bucket").value.trim() : "", 
            cloudKey: document.getElementById("cloud-key") ? document.getElementById("cloud-key").value.trim() : "", 
            cloudSecret: document.getElementById("cloud-secret") ? document.getElementById("cloud-secret").value.trim() : "" 
        };
        try { 
            await window.fetchAPI('/settings', 'POST', window.currentSettings); 
            window.showToast("System Configuration Saved!", "success"); 
            window.fetchSettings(); 
        } catch(err) { 
            if(err.message !== "LICENSE_EXPIRED") window.showToast(err.message || "Failed to save settings.", "error"); 
        }
    };

    window.autoSelectPermissions = function() {
        const roleEl = document.getElementById("new-user-role");
        if(!roleEl) return;
        const role = roleEl.value;
        const checkboxes = document.querySelectorAll('.perm-chk');
        if (role === 'staff') return;
        checkboxes.forEach(chk => chk.checked = false);
        if (role === 'admin') { checkboxes.forEach(chk => chk.checked = true); } 
        else if (role === 'manager') { const perms = ['dash', 'inv', 'bill', 'sales', 'customers', 'expenses', 'reports']; checkboxes.forEach(chk => { if(perms.includes(chk.value)) chk.checked = true; }); } 
        else if (role === 'cashier') { const perms = ['bill', 'sales', 'customers']; checkboxes.forEach(chk => { if(perms.includes(chk.value)) chk.checked = true; }); } 
        else if (role === 'accountant') { const perms = ['dash', 'sales', 'expenses', 'reports']; checkboxes.forEach(chk => { if(perms.includes(chk.value)) chk.checked = true; }); }
    };

    window.fetchUsers = async function() { 
        try { 
            window.allUsersData = await window.fetchAPI('/users'); 
            const tbody = document.getElementById("users-table"); 
            if(tbody) tbody.innerHTML = window.allUsersData.map(u => `<tr><td style="font-weight:600; color:var(--text-main);">${u.username}</td><td style="color:var(--primary); font-weight:600; text-transform:capitalize;">${u.role}</td><td style="font-size:12px; color:var(--text-muted);">${u.perms.length > 0 ? u.perms.join(', ') : '<em style="color: var(--danger);">No Access</em>'}</td><td style="display: flex; gap: 5px;">${u.username !== 'admin' ? `<button type="button" class="btn-edit" onclick="window.editUser('${u.username}')">Edit</button><button type="button" class="btn-danger" style="padding:6px 12px;" onclick="window.deleteUser('${u.username}')">Remove</button>` : '<span style="color:var(--text-muted); font-weight:600;">System</span>'}</td></tr>`).join(''); 
        } catch(e) {} 
    };

    window.editUser = function(username) { 
        const user = window.allUsersData.find(u => u.username === username); if (!user) return; 
        window.editingUsername = username; 
        document.getElementById("new-user-name").value = user.username; document.getElementById("new-user-name").disabled = true; 
        document.getElementById("new-user-pass").value = ""; document.getElementById("new-user-pass").placeholder = "Leave blank to keep current password"; 
        document.getElementById("new-user-role").value = user.role; 
        document.querySelectorAll('.perm-chk').forEach(chk => { chk.checked = user.perms.includes(chk.value); }); 
        document.getElementById("btn-create-user").innerText = "💾 Update User Rights"; document.getElementById("btn-create-user").style.background = "var(--success)"; 
        document.getElementById("btn-cancel-user").style.display = "block"; document.getElementById("card-users").scrollIntoView({ behavior: 'smooth' }); 
    };

    window.cancelUserEdit = function() { 
        window.editingUsername = null; 
        document.getElementById("new-user-name").value = ""; document.getElementById("new-user-name").disabled = false; 
        document.getElementById("new-user-pass").value = ""; document.getElementById("new-user-pass").placeholder = "Min 6 chars"; 
        document.getElementById("new-user-role").value = "staff"; document.querySelectorAll('.perm-chk').forEach(chk => chk.checked = false); 
        document.getElementById("btn-create-user").innerText = "+ Create New User"; document.getElementById("btn-create-user").style.background = "var(--text-main)"; 
        document.getElementById("btn-cancel-user").style.display = "none"; 
    };

    window.createNewUser = async function() { 
        const username = document.getElementById("new-user-name").value.trim(); const password = document.getElementById("new-user-pass").value; const role = document.getElementById("new-user-role").value; 
        const perms = []; document.querySelectorAll('.perm-chk:checked').forEach(chk => perms.push(chk.value)); 
        if (!username) return window.showToast("Username is required.", "error"); 
        try { 
            if (window.editingUsername) { await window.fetchAPI(`/users/${window.editingUsername}`, 'PUT', { password, role, perms }); window.showToast("User access rights updated successfully!", "success"); } 
            else { if (!password || password.length < 6) return window.showToast("Password must be at least 6 characters.", "error"); await window.fetchAPI('/users', 'POST', { username, password, role, perms }); window.showToast("User added securely!", "success"); } 
            window.cancelUserEdit(); window.fetchUsers(); 
        } catch(e) { if(e.message !== "LICENSE_EXPIRED") window.showToast(e.message || "Failed to save user.", "error"); } 
    };

    window.deleteUser = async function(username) { if(!confirm(`Revoke access for ${username}?`)) return; try { await window.fetchAPI(`/users/${username}`, 'DELETE'); window.fetchUsers(); } catch(e) {} };

    window.downloadBackup = async function() { 
        const type = document.getElementById("backup-type").value; 
        try { 
            const data = await window.fetchAPI(`/backup?type=${type}`); 
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); 
            const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `POS_Backup_${type.toUpperCase()}_${new Date().toISOString().split('T')[0]}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link); 
        } catch (e) { if(e.message !== "LICENSE_EXPIRED") window.showToast("Backup failed: " + e.message, "error"); } 
    };

    window.handleRestore = function(event) { 
        const file = event.target.files[0]; if (!file) return; 
        if (!confirm("⚠️ CRITICAL WARNING: This will overwrite your live database.\n\nProceed?")) { event.target.value = ""; return; } 
        const reader = new FileReader(); 
        reader.onload = async function(e) { 
            try { const res = await window.fetchAPI('/restore', 'POST', JSON.parse(e.target.result)); alert(res.message + "\n\nReloading..."); window.location.reload(); } 
            catch (err) { window.showToast("Restore failed. Invalid file.", "error"); } 
            document.getElementById('restoreFileInput').value = ''; 
        }; reader.readAsText(file); 
    };

    window.handleReset = async function() { 
        const select = document.getElementById("reset-type"); const type = select.value; const typeText = select.options[select.selectedIndex].text; 
        if (!confirm(`⚠️ CRITICAL WARNING ⚠️\n\nYou are about to execute:\n"${typeText}"\n\nThis will permanently delete data from your system. This action CANNOT be undone.\n\nAre you absolutely sure you want to proceed?`)) return; 
        if (type !== 'sales_only') { const check = prompt("To confirm this destructive action, please type the word 'RESET' below in all caps:"); if (check !== 'RESET') return window.showToast("Security check failed. Reset cancelled.", "error"); } 
        try { const res = await window.fetchAPI('/reset', 'POST', { type }); alert(res.message + "\n\nReloading application to apply changes."); window.location.reload(); } 
        catch (err) { if(err.message !== "LICENSE_EXPIRED") window.showToast("Reset failed: " + err.message, "error"); } 
    };

    window.resetLocalPassword = async function() {
        const key = prompt("SECURITY CHECK:\nTo reset the local Admin password, you must enter your active Cloud License Key:"); if (!key) return;
        try {
            const res = await fetch('/api/auth/reset-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licenseKey: key }) });
            const data = await res.json();
            if (res.ok) { alert("✅ " + data.message + "\n\nYou can now log in with the username 'admin' and password 'admin123'. Please change this in the Settings tab immediately."); } 
            else { alert("❌ Reset Failed: " + data.error); }
        } catch (e) { alert("❌ Error reaching the local server."); }
    };

    window.activateLicenseUI = async function() {
        const key = document.getElementById("license-key-input").value.trim().toUpperCase();
        if (!key) return alert("Please enter a valid License Key.");
        
        const btn = document.querySelector('#subscription-lock button.btn-primary');
        let oldText = "Activate System";
        if (btn) { oldText = btn.innerText; btn.innerText = "Activating..."; btn.disabled = true; }

        try {
            const res = await fetch('/api/activate-license', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ key, action: 'activate' }) 
            });
            
            const text = await res.text();
            let data = {};
            try { data = JSON.parse(text); } catch(e) { data.error = text || "Local server proxy error"; }

            if (res.ok && data.valid) { 
                alert("✅ System Unlocked!\n\nPlan: " + (data.planType || 'BASIC').toUpperCase() + "\nValid Until: " + new Date(data.validUntil).toLocaleDateString()); 
                window.location.reload(); 
            } else { 
                alert("❌ Activation Failed: " + (data.error || "Key rejected.")); 
            }
        } catch (e) { 
            alert("❌ Connection Error: The local server might have restarted. Please wait 3 seconds and click activate again."); 
        } finally {
            if (btn) { btn.innerText = oldText; btn.disabled = false; }
        }
    };

    window.enterNewKey = async function() {
        const key = prompt("Please enter your new License Key (e.g., BB-XXXXXX):");
        if (!key) return;
        
        try {
            const res = await fetch('/api/activate-license', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ key: key.trim().toUpperCase(), action: 'activate' }) 
            });
            
            const text = await res.text();
            let data = {};
            try { data = JSON.parse(text); } catch(e) { data.error = text || "Local server proxy error"; }

            if (res.ok && data.valid) { 
                alert("✅ System Successfully Updated!\n\nNew Plan: " + (data.planType || 'BASIC').toUpperCase() + "\nValid Until: " + new Date(data.validUntil).toLocaleDateString()); 
                window.location.reload(); 
            } else { 
                alert("❌ Activation Failed: " + (data.error || "Key rejected.")); 
            }
        } catch (e) { 
            alert("❌ Connection Error: The local server might have restarted. Please wait 3 seconds and try again."); 
        }
    };
	
	
	
	window.viewAuditLogs = async function() {
        try {
            const logs = await window.fetchAPI('/audit-logs');
            if (!logs || logs.length === 0) return alert("No security logs found.");

            // Build a sleek, dark-mode terminal view for the logs
            let logHtml = `<div style="max-height: 400px; overflow-y: auto; background: #0f172a; color: #a7f3d0; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 13px; line-height: 1.5;">`;

            logs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('en-IN');
                
                // Color-code the actions for easy scanning!
                let actionColor = "#fbbf24"; // Yellow for Updates
                if (log.action.includes('DELETE')) actionColor = "#ef4444"; // Red for Deletions
                if (log.action.includes('LOGIN')) actionColor = "#3b82f6"; // Blue for Logins
                if (log.action.includes('CREATE')) actionColor = "#10b981"; // Green for Additions

                logHtml += `<div style="margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">`;
                logHtml += `<span style="color: #64748b;">[${date}]</span> `;
                logHtml += `<strong style="color: #ffffff;">${window.escapeHTML(log.username)}</strong> performed `;
                logHtml += `<strong style="color: ${actionColor};">${log.action}</strong> on <strong>${log.entity}</strong><br>`;
                logHtml += `<span style="color: #cbd5e1;">&gt; ${window.escapeHTML(log.details)}</span>`;
                logHtml += `</div>`;
            });

            logHtml += `</div>`;

            // Create a floating popup modal on the screen
            const overlay = document.createElement('div');
            overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); display:flex; justify-content:center; align-items:center; z-index:99999; backdrop-filter: blur(4px);";
            overlay.innerHTML = `
                <div style="background: var(--surface, #ffffff); padding: 25px; border-radius: 12px; width: 700px; max-width: 95%; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                    <h2 style="margin-top:0; margin-bottom: 15px; color: var(--text, #0f172a); display: flex; align-items: center; gap: 10px;">
                        🛡️ Security & Audit Logs
                    </h2>
                    ${logHtml}
                    <button class="btn-primary" style="margin-top:20px; width:100%; background: var(--text-muted, #64748b); padding: 12px; border:none; border-radius: 8px; color: white; font-weight: bold; cursor:pointer;" onclick="this.parentElement.parentElement.remove()">Close Security Viewer</button>
                </div>
            `;
            document.body.appendChild(overlay);

        } catch(e) {
            alert("Failed to load audit logs. Are you logged in as Admin?");
        }
    };

})();;

;(function() {
    
    // 1. The Master i18n Dictionary
    window.i18nDict = {
        en: {
            nav_dash: "📊 Dashboard", nav_inv: "📦 Inventory", nav_bill: "🧾 Billing", nav_settings: "⚙️ Settings",
            nav_sales: "📈 Sales History", nav_customers: "👥 CRM & Khata", nav_credit: "💳 Credit Ledger", nav_expenses: "💸 Expenses", nav_reports: "📑 Reports",
            
            // Billing Strings
            title_billing: "New Invoice", lbl_cust_details: "👤 Customer Details", ph_search: "🔍 Scan barcode or search...", ph_qty: "Qty", btn_add_cart: "Add to Bill", ph_custom_item: "Custom Item", ph_price: "Price", btn_add_custom: "Add Custom Item", title_current_bill: "Current Bill", lbl_show_discount: "Show Item Discount", lbl_subtotal: "Subtotal:", lbl_discount: "Discount:", lbl_tax: "Tax:", lbl_grand_total: "Grand Total:", btn_checkout: "💳 Proceed to Payment", title_payment: "Complete Payment", lbl_amount_to_pay: "Amount to Pay", title_split_payment: "Split Payment Methods", lbl_cash: "💵 Cash", lbl_upi: "📱 UPI (GPay)", lbl_card: "💳 Card", lbl_wallet: "💼 Wallet", lbl_remaining: "Remaining / Credit:", btn_confirm_pay: "✅ Confirm Payment & Print",
            
            // Dashboard Strings
            title_overview: "Overview", lbl_total_rev: "Total Revenue", lbl_total_exp: "Total Expenses", lbl_net_profit: "Net Profit", lbl_low_stock: "Low Stock", title_sales_analytics: "📈 Sales Analytics", title_recent_tx: "Recent Transactions",
            
            // Inventory Strings
            title_inventory: "Inventory Management", btn_import: "📥 Import", btn_export: "📤 Export", btn_add_item: "+ Add Item", title_new_prod: "New Product",
            lbl_sku: "SKU / Barcodes", lbl_item_name: "Item Name", lbl_category: "Category", lbl_stock: "Total Stock", lbl_action: "Action"
        },
        ml: {
            nav_dash: "📊 ഡാഷ്ബോർഡ്", nav_inv: "📦 ഇൻവെന്ററി", nav_bill: "🧾 ബില്ലിംഗ്", nav_settings: "⚙️ ക്രമീകരണങ്ങൾ",
            nav_sales: "📈 വിൽപ്പന ചരിത്രം", nav_customers: "👥 ഉപഭോക്താക്കൾ", nav_credit: "💳 ക്രെഡിറ്റ് ബുക്ക്", nav_expenses: "💸 ചെലവുകൾ", nav_reports: "📑 റിപ്പോർട്ടുകൾ",
            
            // Billing Strings
            title_billing: "പുതിയ ബിൽ", lbl_cust_details: "👤 ഉപഭോക്തൃ വിവരങ്ങൾ", ph_search: "🔍 ബാർകോഡ് സ്കാൻ ചെയ്യുക...", ph_qty: "അളവ്", btn_add_cart: "ബില്ലിലേക്ക് ചേർക്കുക", ph_custom_item: "കസ്റ്റം ഐറ്റം", ph_price: "വില", btn_add_custom: "കസ്റ്റം ഐറ്റം ചേർക്കുക", title_current_bill: "നിലവിലെ ബിൽ", lbl_show_discount: "ഐറ്റം ഡിസ്കൗണ്ട് കാണിക്കുക", lbl_subtotal: "ഉപമൊത്തം:", lbl_discount: "കിഴിവ്:", lbl_tax: "നികുതി:", lbl_grand_total: "ആകെ തുക:", btn_checkout: "💳 പണമടയ്ക്കുക", title_payment: "പേയ്‌മെന്റ് പൂർത്തിയാക്കുക", lbl_amount_to_pay: "അടയ്ക്കേണ്ട തുക", title_split_payment: "പേയ്മെന്റ് രീതികൾ", lbl_cash: "💵 പണം", lbl_upi: "📱 യു.പി.ഐ", lbl_card: "💳 കാർഡ്", lbl_wallet: "💼 വാലറ്റ്", lbl_remaining: "ബാക്കി / ക്രെഡിറ്റ്:", btn_confirm_pay: "✅ ഉറപ്പാക്കി പ്രിന്റ് ചെയ്യുക",
            
            // Dashboard Strings
            title_overview: "അവലോകനം", lbl_total_rev: "ആകെ വരുമാനം", lbl_total_exp: "ആകെ ചെലവുകൾ", lbl_net_profit: "ലാഭം", lbl_low_stock: "കുറഞ്ഞ സ്റ്റോക്ക്", title_sales_analytics: "📈 വിൽപ്പന വിശകലനം", title_recent_tx: "സമീപകാല ഇടപാടുകൾ",
            
            // Inventory Strings
            title_inventory: "ഇൻവെന്ററി മാനേജ്മെന്റ്", btn_import: "📥 ഇംപോർട്ട്", btn_export: "📤 എക്സ്പോർട്ട്", btn_add_item: "+ ഐറ്റം ചേർക്കുക", title_new_prod: "പുതിയ ഉൽപ്പന്നം",
            lbl_sku: "എസ്.കെ.യു / ബാർകോഡ്", lbl_item_name: "ഉൽപ്പന്നത്തിന്റെ പേര്", lbl_category: "വിഭാഗം", lbl_stock: "സ്റ്റോക്ക്", lbl_action: "ആക്ഷൻ"
        },
        ar: {
            nav_dash: "📊 لوحة القيادة", nav_inv: "📦 المخزون", nav_bill: "🧾 الفواتير", nav_settings: "⚙️ الإعدادات",
            nav_sales: "📈 سجل المبيعات", nav_customers: "👥 العملاء", nav_credit: "💳 دفتر الديون", nav_expenses: "💸 المصروفات", nav_reports: "📑 التقارير",
            
            // Billing Strings
            title_billing: "فاتورة جديدة", lbl_cust_details: "👤 تفاصيل العميل", ph_search: "🔍 امسح الباركود أو ابحث...", ph_qty: "الكمية", btn_add_cart: "أضف إلى الفاتورة", ph_custom_item: "عنصر مخصص", ph_price: "السعر", btn_add_custom: "إضافة عنصر مخصص", title_current_bill: "الفاتورة الحالية", lbl_show_discount: "إظهار خصم العنصر", lbl_subtotal: "المجموع الفرعي:", lbl_discount: "خصم:", lbl_tax: "ضريبة:", lbl_grand_total: "المجموع الإجمالي:", btn_checkout: "💳 الدفع", title_payment: "إتمام الدفع", lbl_amount_to_pay: "المبلغ الدفع", title_split_payment: "طرق الدفع", lbl_cash: "💵 نقدي", lbl_upi: "📱 واجهة الدفع", lbl_card: "💳 بطاقة", lbl_wallet: "💼 محفظة", lbl_remaining: "المتبقي / ائتمان:", btn_confirm_pay: "✅ تأكيد الدفع والطباعة",
            
            // Dashboard Strings
            title_overview: "نظرة عامة", lbl_total_rev: "إجمالي الإيرادات", lbl_total_exp: "إجمالي المصروفات", lbl_net_profit: "صافي الربح", lbl_low_stock: "مخزون منخفض", title_sales_analytics: "📈 تحليل المبيعات", title_recent_tx: "المعاملات الأخيرة",
            
            // Inventory Strings
            title_inventory: "إدارة المخزون", btn_import: "📥 استيراد", btn_export: "📤 تصدير", btn_add_item: "+ إضافة عنصر", title_new_prod: "منتج جديد",
            lbl_sku: "باركود", lbl_item_name: "اسم العنصر", lbl_category: "فئة", lbl_stock: "إجمالي المخزون", lbl_action: "إجراء"
        }
    };

    // 2. The Translation Helper Function
    window.t = function(key) {
        const lang = (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.language) 
            ? window.currentSettings.globalPrefs.language 
            : 'en';
        return window.i18nDict[lang][key] || window.i18nDict['en'][key] || key;
    };

    // 3. The DOM Scanner
    window.applyTranslations = function() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (el.tagName === 'INPUT' && el.type === 'text') {
                el.placeholder = window.t(key);
            } else {
                el.innerText = window.t(key);
            }
        });
        
        const lang = (window.currentSettings && window.currentSettings.globalPrefs) ? window.currentSettings.globalPrefs.language : 'en';
        document.body.dir = (lang === 'ar') ? 'rtl' : 'ltr';
    };
    
    // THE EXTRA BRACKET WAS HERE - IT IS NOW REMOVED!

    window.escapeHTML = function(str) {
        if (!str) return "";
        return String(str).replace(/[&<>'"]/g, function(tag) {
            const charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
            return charsToReplace[tag] || tag;
        });
    };

    document.addEventListener("DOMContentLoaded", async function() {
        const safeAdd = function(id, evt, fn) {
            const el = document.getElementById(id);
            if (el) el.addEventListener(evt, fn);
        };

        safeAdd("loginBtn", "click", function() { if (window.handleLogin) window.handleLogin(); });
        safeAdd("logoutBtn", "click", function() { if (window.handleLogout) window.handleLogout(); });

        const logoUpload = document.getElementById("logoUpload");
        if (logoUpload) {
            logoUpload.addEventListener("change", function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(event) { 
                        if(window.currentSettings) window.currentSettings.logoBase64 = event.target.result; 
                        const preview = document.getElementById("logoPreview");
                        if(preview) { preview.src = event.target.result; preview.style.display = "block"; }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        const token = localStorage.getItem("token");
        if (token) {
            const authSec = document.getElementById("auth-section");
            const appSec = document.getElementById("app-section");
            if(authSec) authSec.style.display = "none";
            if(appSec) appSec.style.display = "flex";
            
            if (window.fetchSettings) window.fetchSettings(); 
            if (window.fetchDashboardStats) window.fetchDashboardStats();
            if (window.fetchInventory) window.fetchInventory();
            if (window.fetchCustomers) window.fetchCustomers();
        } else {
            try {
                if (window.fetchAPI) {
                    const check = await window.fetchAPI('/check-license');
                    if (!check.expired) {
                        const lLock = document.getElementById("subscription-lock");
                        const aSec = document.getElementById("auth-section");
                        if(lLock) lLock.style.display = "none";
                        if(aSec) aSec.style.display = "block";
                    } else {
                        if (window.triggerLockScreen) window.triggerLockScreen();
                    }
                }
            } catch(e) { 
                if (window.triggerLockScreen) window.triggerLockScreen(); 
            }
        }
    });

    window.fetchDashboardStats = async function() {
        try {
            if (!window.fetchAPI) return;
            const data = await window.fetchAPI('/stats');
            
            if(document.getElementById('stat-sales')) document.getElementById('stat-sales').innerText = `₹${(data.totalSales || 0).toFixed(2)}`;
            if(document.getElementById('stat-exp')) document.getElementById('stat-exp').innerText = `₹${(data.totalExpenses || 0).toFixed(2)}`;
            if(document.getElementById('stat-profit')) document.getElementById('stat-profit').innerText = `₹${(data.totalProfit || 0).toFixed(2)}`;
            if(document.getElementById('stat-invoices')) document.getElementById('stat-invoices').innerText = data.totalInvoices || 0;
            if(document.getElementById('stat-stock')) document.getElementById('stat-stock').innerText = data.lowStockCount || 0;

            const recentBody = document.getElementById('dashboard-recent');
            if (recentBody) {
                if (Array.isArray(data.recentTransactions) && data.recentTransactions.length > 0) {
                    recentBody.innerHTML = data.recentTransactions.map(function(tx) {
                        const total = parseFloat(tx.grandTotal) || 0;
                        return `<tr><td>${tx.id}</td><td>${new Date(tx.date).toLocaleDateString()}</td><td style="font-weight:bold; color:var(--success);">₹${total.toFixed(2)}</td></tr>`;
                    }).join('');
                } else {
                    recentBody.innerHTML = `<tr><td colspan="3" style="text-align: center;">No recent transactions</td></tr>`;
                }
            }

            if (data.chartData && Array.isArray(data.chartData.labels) && data.chartData.labels.length > 0) {
                if (window.dashChart) window.dashChart.destroy();
                const ctx = document.getElementById('dashboardChart');
                if (ctx) {
                    window.dashChart = new Chart(ctx.getContext('2d'), {
                        type: 'line',
                        data: {
                            labels: data.chartData.labels,
                            datasets: [{
                                label: 'Daily Revenue (₹)',
                                data: data.chartData.data,
                                borderColor: '#4f46e5',
                                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                                borderWidth: 2, fill: true, tension: 0.4
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false }
                    });
                }
            }
        } catch(err) { console.error("Dashboard Fetch Error:", err); }
    };

    window.switchTab = function(tabId) {
        document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active-view'); });
        document.querySelectorAll('#sidebar button').forEach(function(b) { b.classList.remove('active'); });
        const viewEl = document.getElementById(`view-${tabId}`);
        if (viewEl) viewEl.classList.add('active-view');
        let navId = tabId; if (tabId === 'inventory') navId = 'inv'; if (tabId === 'billing') navId = 'bill';
        const navBtn = document.querySelector(`#nav-${navId} button`); if (navBtn) navBtn.classList.add('active');

        if (tabId === 'dashboard' && window.fetchDashboardStats) window.fetchDashboardStats();
        if (tabId === 'inventory' && window.fetchInventory) window.fetchInventory();
        if (tabId === 'customers' && window.fetchCustomers) window.fetchCustomers();
        if (tabId === 'expenses' && window.fetchExpenses) window.fetchExpenses();
        if (tabId === 'sales' && window.fetchSalesHistory) window.fetchSalesHistory();
        if (tabId === 'settings' && window.fetchUsers) window.fetchUsers();
		if (tabId === 'credit' && window.fetchCreditLedger) window.fetchCreditLedger();
    };
    
    const evts = ['mousemove', 'keydown', 'scroll', 'click'];
    for(let i=0; i<evts.length; i++) {
        document.addEventListener(evts[i], function() {
            if (typeof window.resetInactivityTimer === "function") window.resetInactivityTimer();
        });
    }
})();;

;(function() {
    window.fetchCreditLedger = async function() {
        try {
            const customers = await window.fetchAPI('/customers');
            const invoiceData = await window.fetchAPI('/invoices?limit=2000'); 
            const allInvoices = invoiceData.invoices || [];

            const tbody = document.getElementById("credit-ledger-table");
            
            const debtors = customers.filter(c => parseFloat(c.creditDue) !== 0);

            if (debtors.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--success); font-weight: 600;">🎉 All accounts settled! No outstanding credit.</td></tr>`;
                return;
            }

            tbody.innerHTML = debtors.map((c, index) => {
                const credit = parseFloat(c.creditDue);
                const accountIsOwed = credit > 0;
                
                // ✅ VIGOROUS SMART FILTER
                const unpaidInvoices = allInvoices.filter(inv => {
                    const phoneMatch = inv.phone && c.phone && inv.phone === c.phone;
                    const nameMatch = inv.customerName && c.name && inv.customerName === c.name;
                    if (!phoneMatch && !nameMatch) return false;

                    if (!inv.id || !inv.id.startsWith('INV-')) return false;
                    if (inv.isSettlement === true) return false;
                    if (inv.items && inv.items.some(i => i.id === 'settlement' || i.name.toLowerCase().includes('settlement') || i.name.toLowerCase().includes('refund'))) return false;

                    if (!inv.payments || typeof inv.payments.creditDue === 'undefined') return false;
                    const invDue = parseFloat(inv.payments.creditDue);
                    if (Math.abs(invDue) < 0.01) return false;

                    // ✅ STRICT POLARITY MATCH:
                    // Only show invoices that match the current Action Button!
                    if (accountIsOwed && invDue < 0) return false; // Hide overpaid invoices if customer owes you
                    if (!accountIsOwed && invDue > 0) return false; // Hide owed invoices if customer is overpaid

                    return true;
                });

                let dropdownHtml = `<select id="settle-inv-${index}" style="margin-bottom: 8px; width: 100%; padding: 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border); font-weight: 600;">`;
                dropdownHtml += `<option value="GENERAL">General Account Settlement</option>`;
                
                unpaidInvoices.forEach(inv => {
                    const invDue = parseFloat(inv.payments.creditDue);
                    // Labels simplified since the polarity now perfectly matches the action button
                    dropdownHtml += `<option value="${inv.id}" data-due="${Math.abs(invDue)}">Settle ${inv.id} (₹${Math.abs(invDue).toFixed(2)})</option>`;
                });
                dropdownHtml += `</select>`;

                return `
                <tr>
                    <td style="font-weight:600;">${window.escapeHTML(c.name)}</td>
                    <td style="font-family:monospace;">${c.phone}</td>
                    <td style="font-weight:bold; color: ${accountIsOwed ? 'var(--danger)' : 'var(--primary)'};">
                        ${accountIsOwed ? 'Owes You' : 'Overpaid (Return)'}
                    </td>
                    <td style="font-weight:bold; font-size: 16px;">₹${Math.abs(credit).toFixed(2)}</td>
                    <td style="min-width: 250px;">
                        ${dropdownHtml}
                        <button class="btn-primary" style="width: 100%; background: ${accountIsOwed ? 'var(--success)' : 'var(--danger)'};" 
                            onclick="window.processCreditSettlement(${index}, '${c.phone}', ${credit}, '${window.escapeHTML(c.name).replace(/'/g, "\\'")}')">
                            ${accountIsOwed ? 'Receive Payment' : 'Issue Refund'}
                        </button>
                    </td>
                </tr>`;
            }).join('');
        } catch (e) { console.error("Ledger Error:", e); }
    };

    window.processCreditSettlement = async function(index, phone, currentCredit, name) {
        const isOwed = currentCredit > 0;
        const actionText = isOwed ? "Payment Received" : "Refund Given";
        
        const selectEl = document.getElementById(`settle-inv-${index}`);
        const selectedOption = selectEl.options[selectEl.selectedIndex];
        const targetInvoice = selectedOption.value;
        
        let defaultAmt = Math.abs(currentCredit).toFixed(2);

        if (targetInvoice !== "GENERAL") {
            const invDue = parseFloat(selectedOption.getAttribute('data-due'));
            defaultAmt = Math.abs(invDue).toFixed(2);
        }

        const amtStr = prompt(`Settling Balance for ${name}\nTarget: ${targetInvoice === 'GENERAL' ? 'Whole Account' : targetInvoice}\n\nEnter ${actionText} Amount:`, defaultAmt);
        
        if (!amtStr) return; 
        const amt = parseFloat(amtStr);
        if (isNaN(amt) || amt <= 0) return alert("Please enter a valid positive amount.");
        
        const method = prompt("Payment Method? (Type: cash, upi, or card)", "cash");
        if (!method) return;

        try {
            let voucherId = "";

            if (targetInvoice === "GENERAL") {
                const adjustment = isOwed ? -Math.abs(amt) : Math.abs(amt);
                const payload = {
                    customerName: name, phone: phone, isSettlement: true, discountVal: 0, discountType: 'flat',
                    items: [{ id: 'settlement', name: isOwed ? 'Khata Debt Settlement' : 'Overpayment Refund', price: 0, qty: 1, discount: 0 }],
                    payments: { cash: method.toLowerCase()==='cash' ? (isOwed ? amt : -amt) : 0, upi: method.toLowerCase()==='upi' ? (isOwed ? amt : -amt) : 0, card: method.toLowerCase()==='card' ? (isOwed ? amt : -amt) : 0, wallet: 0, loyalty: 0, creditDue: adjustment },
                    taxConfig: { rate: 0, type: 'exclusive' }
                };
                const data = await window.fetchAPI('/invoices', 'POST', payload);
                voucherId = data.invoice.id;
                if (window.showToast) window.showToast(`Account balance adjusted!`, "success");
            } else {
                const res = await window.fetchAPI('/invoices/settle', 'POST', {
                    originalInvoiceId: targetInvoice, amount: amt, payMethod: method.toLowerCase(), customerName: name, phone: phone
                });
                voucherId = res.receiptId;
                if (window.showToast) window.showToast(res.message, "success");
            }

            if (window.currentSettings && window.currentSettings.globalPrefs && window.currentSettings.globalPrefs.enableWhatsapp && phone) {
                const bpName = window.currentSettings.businessProfile?.name || "Our Shop";
                const newTotalBal = isOwed ? (currentCredit - amt) : (currentCredit + amt);
                
                let msg = `Hello ${name}, from ${bpName}!\n\n`;
                msg += `🧾 *${actionText}*\n`;
                msg += `Amount: ₹${amt.toFixed(2)} (${method.toUpperCase()})\n`;
                if (targetInvoice !== "GENERAL") msg += `Applied to Invoice: ${targetInvoice}\n`;
                msg += `Voucher ID: ${voucherId}\n\n`;
                
                if (Math.abs(newTotalBal) > 0.01) {
                    msg += `Overall Khata Balance: ₹${Math.abs(newTotalBal).toFixed(2)} (${newTotalBal > 0 ? 'Owed' : 'Overpaid'})\n\n`;
                } else {
                    msg += `Overall Khata Balance: ₹0.00 (Fully Settled! 🎉)\n\n`;
                }
                msg += `Thank you!`;
                
                try {
                    if(window.showToast) window.showToast(`Sending WhatsApp Notification...`, "success");
                    await window.fetchAPI('/whatsapp/send', 'POST', { phone: phone, message: msg, pdfBase64: null });
                } catch(e) {}
            }

            window.fetchCreditLedger();
            if(window.fetchCustomers) window.fetchCustomers();
            if(window.fetchSalesHistory) window.fetchSalesHistory();
            if(window.fetchDashboardStats) window.fetchDashboardStats();
        } catch (e) {
            alert("Failed to update balance.");
        }
    };
})();