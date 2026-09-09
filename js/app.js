/* ============================================================
   Shake 'n Chill – Main Application JS
   All 7 features: Dashboard, Inventory, Categories,
   Stock Management, Suppliers, Reports, Settings
   ============================================================ */
'use strict';

// ──────────────────────────────────────────────────────────────
//  0.  GLOBAL STATE & HELPERS
// ──────────────────────────────────────────────────────────────
const state = {
  user:        null,
  userProfile: null,
  products:    [],
  categories:  [],
  suppliers:   [],
  transactions:[],
  storeSettings: {
    name:      'My Store',
    currency:  '₱',
    threshold: 10,
    code:      '',
    address:   '',
    phone:     '',
    email:     ''
  },
  charts: {},
  confirmCallback: null,
  unsubscribers:   []
};

/* Shorthand */
const $ = id => document.getElementById(id);

/* Toast notifications */
function toast(msg, type = 'success', duration = 3500) {
  const wrap = $('toast-container');
  const el   = document.createElement('div');
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark',
                  warning:'fa-triangle-exclamation', info:'fa-circle-info' };
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa ${icons[type] || icons.info}"></i> ${msg}`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)';
    el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, duration);
}

/* Modal helpers */
function openModal(id)  { $(id).classList.add('open');  document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.remove('open'); document.body.style.overflow = ''; }

/* Format currency */
function currency(val) {
  const sym = state.storeSettings.currency || '₱';
  return `${sym}${parseFloat(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* Format date */
function fmtDate(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtDateShort(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
}

/* Sanitise input to prevent XSS */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* Stock status */
function stockStatus(qty, minStock) {
  const min = minStock || state.storeSettings.threshold || 10;
  if (qty <= 0)       return { label:'Out of Stock', cls:'badge-danger',   row:'row-out-of-stock' };
  if (qty <= min)     return { label:'Low Stock',    cls:'badge-warning',  row:'row-low-stock' };
  return               { label:'In Stock',      cls:'badge-success',  row:'' };
}

/* Navigation */
const PAGE_TITLES = {
  dashboard: 'Dashboard', inventory: 'Inventory', categories: 'Categories',
  stock:     'Stock Management', suppliers: 'Suppliers',
  reports:   'Reports',   settings: 'Settings'
};

function navigateTo(page) {
  // Hide all sections
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active');
    n.removeAttribute('aria-current');
  });

  const section = $(`page-${page}`);
  const navBtn  = document.querySelector(`[data-page="${page}"]`);
  if (section) section.classList.add('active');
  if (navBtn)  { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }

  $('topbar-title').textContent = PAGE_TITLES[page] || page;

  // Close sidebar on mobile after nav
  if (window.innerWidth <= 768) closeSidebar();

  // Trigger page-specific refresh
  const refreshMap = {
    dashboard:  refreshDashboard,
    inventory:  renderInventoryTable,
    categories: renderCategoryCards,
    stock:      renderTransactionTable,
    suppliers:  renderSuppliersTable,
    reports:    renderReportSummary,
    settings:   loadSettingsPage
  };
  if (refreshMap[page]) refreshMap[page]();
}

/* Sidebar mobile toggle */
function openSidebar()  { $('sidebar').classList.add('open'); $('sidebar-overlay').classList.add('open'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').classList.remove('open'); }

// ──────────────────────────────────────────────────────────────
//  1.  AUTH & BOOT
// ──────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) return; // handled by index.html auth screen
  state.user = user;

  // Load user profile from Firestore
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    if (snap.exists) {
      state.userProfile = snap.data();
    } else {
      // First-time user — seed profile as admin
      const profile = {
        uid:        user.uid,
        email:      user.email,
        name:       user.displayName || user.email.split('@')[0],
        role:       'admin',   // first user is always admin
        createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin:  firebase.firestore.FieldValue.serverTimestamp()
      };
      try {
        await db.collection('users').doc(user.uid).set(profile);
      } catch (writeErr) {
        console.warn('Could not write user profile (check Firestore rules):', writeErr.message);
      }
      state.userProfile = profile;
    }
    // Update lastLogin (non-blocking)
    db.collection('users').doc(user.uid).update({
      lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  } catch (e) {
    console.warn('Profile load error:', e.message);
    state.userProfile = { name: user.email.split('@')[0], role: 'admin' };
  }

  // Update sidebar user display
  const name  = state.userProfile?.name || user.email;
  const role  = state.userProfile?.role || 'staff';
  const init  = name.charAt(0).toUpperCase();
  $('user-display-name').textContent = name;
  $('user-role-label').textContent   = role.charAt(0).toUpperCase() + role.slice(1);
  $('user-avatar').textContent       = init;

  // Load store settings
  await loadStoreSettings();

  // Start real-time listeners
  startListeners();

  // Show app (already shown by index.html auth handler)
  $('app-loading').style.display = 'none';
  if ($('app-wrapper')) $('app-wrapper').style.display = 'block';

  // Re-attach all event listeners now that DOM is visible
  initAppListeners();

  // Set dashboard date
  $('dashboard-date').textContent = new Date().toLocaleDateString('en-PH',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  navigateTo('dashboard');
});

async function loadStoreSettings() {
  try {
    const snap = await db.collection('settings').doc('store').get();
    if (snap.exists) Object.assign(state.storeSettings, snap.data());
  } catch(e) { /* use defaults */ }
}

// ──────────────────────────────────────────────────────────────
//  2.  REAL-TIME FIRESTORE LISTENERS
// ──────────────────────────────────────────────────────────────
function startListeners() {
  // Products
  const unsubProducts = db.collection('products').orderBy('name')
    .onSnapshot(snap => {
      state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderInventoryTable();
      updateLowStockBadge();
      updateDashboardStats();
    }, err => console.error('Products listener:', err));

  // Categories
  const unsubCats = db.collection('categories').orderBy('name')
    .onSnapshot(snap => {
      state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCategoryCards();
      populateCategoryDropdowns();
    }, err => console.error('Categories listener:', err));

  // Suppliers
  const unsubSups = db.collection('suppliers').orderBy('name')
    .onSnapshot(snap => {
      state.suppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSuppliersTable();
      populateSupplierDropdowns();
    }, err => console.error('Suppliers listener:', err));

  // Transactions (last 200)
  const unsubTxn = db.collection('transactions').orderBy('createdAt','desc').limit(200)
    .onSnapshot(snap => {
      state.transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTransactionTable();
      renderRecentActivity();
    }, err => console.error('Transactions listener:', err));

  state.unsubscribers.push(unsubProducts, unsubCats, unsubSups, unsubTxn);
}

function stopListeners() {
  state.unsubscribers.forEach(fn => fn());
  state.unsubscribers = [];
}

// ──────────────────────────────────────────────────────────────
//  3.  DASHBOARD
// ──────────────────────────────────────────────────────────────
function updateDashboardStats() {
  const products   = state.products;
  const totalQty   = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
  const totalValue = products.reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.price) || 0), 0);
  const lowItems   = products.filter(p => {
    const min = p.minStock || state.storeSettings.threshold || 10;
    return (Number(p.quantity) || 0) <= min;
  }).length;

  $('stat-total-products').textContent = products.length;
  $('stat-total-value').textContent    = currency(totalValue);
  $('stat-low-stock').textContent      = lowItems;
  $('stat-categories').textContent     = state.categories.length;

  renderLowStockList();
  renderCategoryChart();
  renderStatusChart();
}

function refreshDashboard() {
  updateDashboardStats();
  renderRecentActivity();
  renderLowStockList();
}

/* Category bar chart */
function renderCategoryChart() {
  const canvas = $('chart-category');
  if (!canvas) return;

  const catCounts = {};
  state.categories.forEach(c => { catCounts[c.name] = 0; });
  state.products.forEach(p => {
    const cat = state.categories.find(c => c.id === p.categoryId);
    const key = cat ? cat.name : 'Uncategorised';
    catCounts[key] = (catCounts[key] || 0) + (Number(p.quantity) || 0);
  });

  const labels = Object.keys(catCounts);
  const data   = Object.values(catCounts);
  const colors = generateColors(labels.length);

  if (state.charts.category) state.charts.category.destroy();
  state.charts.category = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Stock Qty', data, backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* Status doughnut chart */
function renderStatusChart() {
  const canvas = $('chart-status');
  if (!canvas) return;

  let inStock = 0, lowStock = 0, outOfStock = 0;
  state.products.forEach(p => {
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    if (qty <= 0)    outOfStock++;
    else if (qty <= min) lowStock++;
    else             inStock++;
  });

  if (state.charts.status) state.charts.status.destroy();
  state.charts.status = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['In Stock', 'Low Stock', 'Out of Stock'],
      datasets: [{
        data: [inStock, lowStock, outOfStock],
        backgroundColor: ['#22c55e','#f59e0b','#ef4444'],
        borderWidth: 0, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 12 } }
      },
      cutout: '65%'
    }
  });
}

/* Recent activity list */
function renderRecentActivity() {
  const el  = $('recent-activity-list');
  const txns = state.transactions.slice(0, 8);
  if (!txns.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No recent activity</p></div>';
    return;
  }
  const typeIcons = { stock_in:'fa-arrow-down', stock_out:'fa-arrow-up', adjustment:'fa-sliders' };
  const typeColors = { stock_in:'var(--success)', stock_out:'var(--danger)', adjustment:'var(--warning)' };
  el.innerHTML = txns.map(t => {
    const prod = state.products.find(p => p.id === t.productId);
    const icon = typeIcons[t.type]  || 'fa-circle';
    const col  = typeColors[t.type] || 'var(--info)';
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 1.25rem;border-bottom:1px solid var(--border);">
      <div style="width:32px;height:32px;border-radius:50%;background:${col}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fa ${icon}" style="color:${col};font-size:.8rem;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.8125rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${esc(prod?.name || t.productName || 'Unknown product')}
        </div>
        <div style="font-size:.75rem;color:var(--text-muted);">${t.type?.replace('_',' ')} · ${fmtDateShort(t.createdAt)}</div>
      </div>
      <div style="font-size:.8125rem;font-weight:700;color:${col};">
        ${t.type === 'stock_in' ? '+' : t.type === 'stock_out' ? '-' : ''}${t.quantity}
      </div>
    </div>`;
  }).join('');
}

/* Low-stock dashboard list */
function renderLowStockList() {
  const el = $('low-stock-list');
  const lowItems = state.products.filter(p => {
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    return qty <= min;
  }).slice(0, 6);

  if (!lowItems.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>All items well-stocked</p></div>';
    return;
  }
  el.innerHTML = lowItems.map(p => {
    const qty   = Number(p.quantity) || 0;
    const min   = p.minStock || state.storeSettings.threshold || 10;
    const pct   = Math.min(100, (qty / (min || 1)) * 100);
    const color = qty <= 0 ? '#ef4444' : '#f59e0b';
    return `<div style="padding:.75rem 1.25rem;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem;">
        <div style="font-size:.8125rem;font-weight:600;color:var(--text);">${esc(p.name)}</div>
        <span style="font-size:.75rem;font-weight:700;color:${color};">${qty} left</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pct}%;background:${color};"></div>
      </div>
    </div>`;
  }).join('');
}

function updateLowStockBadge() {
  const count = state.products.filter(p => {
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    return qty <= min;
  }).length;

  const badge = $('low-stock-badge');
  const dot   = $('notif-dot');
  if (count > 0) {
    badge.style.display = 'inline-block';
    badge.textContent   = count > 9 ? '9+' : count;
    dot.style.display   = 'block';
  } else {
    badge.style.display = 'none';
    dot.style.display   = 'none';
  }
}

function generateColors(n) {
  const palette = ['#2563eb','#22c55e','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#f97316','#64748b'];
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

// ──────────────────────────────────────────────────────────────
//  4.  INVENTORY / PRODUCTS
// ──────────────────────────────────────────────────────────────
function renderInventoryTable(filter) {
  const search   = ($('inv-search')?.value || '').toLowerCase();
  const catFilter = $('inv-filter-category')?.value || '';
  const statFilter = $('inv-filter-status')?.value || '';

  let rows = state.products.filter(p => {
    const matchSearch = !search ||
      p.name?.toLowerCase().includes(search) ||
      p.sku?.toLowerCase().includes(search);
    const matchCat = !catFilter || p.categoryId === catFilter;
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    const status = qty <= 0 ? 'out_of_stock' : qty <= min ? 'low_stock' : 'in_stock';
    const matchStat = !statFilter || status === statFilter;
    return matchSearch && matchCat && matchStat;
  });

  const tbody = $('inv-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">📦</div><h4>No products found</h4>
      <p>Try adjusting your filters or add a new product.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const cat     = state.categories.find(c => c.id === p.categoryId);
    const qty     = Number(p.quantity) || 0;
    const price   = Number(p.price) || 0;
    const value   = qty * price;
    const st      = stockStatus(qty, p.minStock);
    return `<tr class="${st.row}">
      <td><code style="font-size:.78rem;background:#f1f5f9;padding:.15rem .4rem;border-radius:4px;">${esc(p.sku || '–')}</code></td>
      <td>
        <div style="font-weight:600;color:var(--text);">${esc(p.name)}</div>
        ${p.description ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:.1rem;">${esc(p.description.substring(0,50))}${p.description.length>50?'…':''}</div>` : ''}
      </td>
      <td>${cat ? `<span style="display:inline-flex;align-items:center;gap:.3rem;">${cat.icon||''} ${esc(cat.name)}</span>` : '<span class="badge badge-gray">Uncategorised</span>'}</td>
      <td><strong>${qty.toLocaleString()}</strong> <span style="font-size:.75rem;color:var(--text-muted);">${esc(p.unit||'')}</span></td>
      <td>${currency(price)}</td>
      <td style="font-weight:600;">${currency(value)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>
        <div style="display:flex;gap:.4rem;">
          <button class="btn btn-sm btn-outline btn-icon" onclick="editProduct('${p.id}')" title="Edit product" aria-label="Edit ${esc(p.name)}">
            <i class="fa fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon" onclick="quickStockIn('${p.id}')" title="Quick stock in" aria-label="Stock in">
            <i class="fa fa-arrow-down" style="color:var(--success)"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon" onclick="confirmDelete('product','${p.id}','${esc(p.name)}')" title="Delete" aria-label="Delete ${esc(p.name)}">
            <i class="fa fa-trash" style="color:var(--danger)"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* Open add-product modal */
function openProductModal(id = null) {
  const form = $('product-form');
  form.reset();
  $('product-id').value = '';
  $('modal-product-title').textContent = id ? 'Edit Product' : 'Add Product';

  populateCategoryDropdowns();
  populateSupplierDropdowns();

  if (id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    $('product-id').value = id;
    $('p-name').value     = p.name || '';
    $('p-sku').value      = p.sku  || '';
    $('p-category').value = p.categoryId || '';
    $('p-supplier').value = p.supplierId || '';
    $('p-qty').value      = p.quantity ?? '';
    $('p-unit').value     = p.unit || '';
    $('p-min-stock').value= p.minStock ?? '';
    $('p-cost').value     = p.cost  || '';
    $('p-price').value    = p.price || '';
    $('p-desc').value     = p.description || '';
  }
  openModal('modal-product');
  $('p-name').focus();
}

window.editProduct     = id => openProductModal(id);
window.quickStockIn    = id => openStockModal('stock_in', id);

async function saveProduct() {
  // Validation
  let valid = true;
  const clearErr = id => { const el = $(id); if(el){el.classList.remove('show');} };
  const showErr  = id => { const el = $(id); if(el){el.classList.add('show');} };
  [['p-name','err-p-name'],['p-category','err-p-category'],
   ['p-qty','err-p-qty'],['p-price','err-p-price']].forEach(([fid, eid]) => {
    clearErr(eid);
    if (!$(fid)?.value?.trim()) { showErr(eid); valid = false; }
  });
  if (!valid) return;

  const id = $('product-id').value;
  const data = {
    name:        $('p-name').value.trim(),
    sku:         $('p-sku').value.trim(),
    categoryId:  $('p-category').value,
    supplierId:  $('p-supplier').value,
    quantity:    Number($('p-qty').value) || 0,
    unit:        $('p-unit').value.trim(),
    minStock:    Number($('p-min-stock').value) || state.storeSettings.threshold || 10,
    cost:        parseFloat($('p-cost').value) || 0,
    price:       parseFloat($('p-price').value) || 0,
    description: $('p-desc').value.trim(),
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy:   state.user.uid
  };

  const btn = $('btn-save-product');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Saving…';

  try {
    if (id) {
      await db.collection('products').doc(id).update(data);
      toast('Product updated successfully.');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = state.user.uid;
      await db.collection('products').add(data);
      toast('Product added successfully.');
    }
    closeModal('modal-product');
  } catch (e) {
    toast(`Error saving product: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-floppy-disk"></i> Save Product';
  }
}

/* Export inventory as CSV */
function exportInventory() {
  const headers = ['SKU','Name','Category','Qty','Unit','Cost Price','Sell Price','Stock Value','Status'];
  const rows    = state.products.map(p => {
    const cat = state.categories.find(c => c.id === p.categoryId);
    const qty = Number(p.quantity) || 0;
    const st  = stockStatus(qty, p.minStock);
    return [
      p.sku||'', p.name||'', cat?.name||'', qty,
      p.unit||'', p.cost||0, p.price||0,
      (qty*(p.price||0)).toFixed(2), st.label
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `inventory_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Inventory exported as CSV.');
}

// ──────────────────────────────────────────────────────────────
//  5.  CATEGORIES
// ──────────────────────────────────────────────────────────────
function renderCategoryCards() {
  const grid   = $('cat-cards-grid');
  const search = ($('cat-search')?.value || '').toLowerCase();
  const cats   = state.categories.filter(c =>
    !search || c.name.toLowerCase().includes(search));

  if (!cats.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏷️</div>
      <h4>No categories yet</h4>
      <p>Click "Add Category" to begin organising your products.</p></div>`;
    return;
  }

  grid.innerHTML = cats.map(c => {
    const count = state.products.filter(p => p.categoryId === c.id).length;
    const col   = c.color || '#2563eb';
    return `<div class="card" style="padding:1.25rem;cursor:default;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;">
        <div style="display:flex;align-items:center;gap:.625rem;">
          <div style="width:40px;height:40px;border-radius:10px;background:${col}22;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">
            ${c.icon || '📦'}
          </div>
          <div>
            <div style="font-weight:700;color:var(--text);font-size:.9375rem;">${esc(c.name)}</div>
            <div style="font-size:.75rem;color:var(--text-muted);">${count} product${count!==1?'s':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:.3rem;">
          <button class="btn btn-sm btn-ghost btn-icon" onclick="editCategory('${c.id}')" title="Edit" aria-label="Edit ${esc(c.name)}">
            <i class="fa fa-pen" style="font-size:.75rem;"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon" onclick="confirmDelete('category','${c.id}','${esc(c.name)}')" title="Delete" aria-label="Delete ${esc(c.name)}">
            <i class="fa fa-trash" style="font-size:.75rem;color:var(--danger)"></i>
          </button>
        </div>
      </div>
      ${c.description ? `<p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.75rem;">${esc(c.description)}</p>` : ''}
      <div style="height:4px;border-radius:4px;background:${col};opacity:.7;"></div>
    </div>`;
  }).join('');
}

function openCategoryModal(id = null) {
  $('category-form').reset();
  $('cat-id').value = '';
  $('modal-cat-title').textContent = id ? 'Edit Category' : 'Add Category';

  if (id) {
    const c = state.categories.find(x => x.id === id);
    if (!c) return;
    $('cat-id').value   = id;
    $('cat-name').value = c.name  || '';
    $('cat-icon').value = c.icon  || '';
    $('cat-color').value= c.color || '#2563eb';
    $('cat-desc').value = c.description || '';
  }
  openModal('modal-category');
  $('cat-name').focus();
}

window.editCategory = id => openCategoryModal(id);

async function saveCategory() {
  const name = $('cat-name').value.trim();
  if (!name) {
    $('err-cat-name').classList.add('show');
    $('cat-name').focus();
    return;
  }
  $('err-cat-name').classList.remove('show');

  const id   = $('cat-id').value;
  const data = {
    name,
    icon:        $('cat-icon').value.trim() || '📦',
    color:       $('cat-color').value,
    description: $('cat-desc').value.trim(),
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
  };

  const btn = $('btn-save-category');
  btn.disabled = true;

  try {
    if (id) {
      await db.collection('categories').doc(id).update(data);
      toast('Category updated.');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('categories').add(data);
      toast('Category added.');
    }
    closeModal('modal-category');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function populateCategoryDropdowns() {
  const selects = ['p-category','inv-filter-category'];
  selects.forEach(sid => {
    const sel = $(sid);
    if (!sel) return;
    const current = sel.value;
    const isFilter = sid === 'inv-filter-category';
    sel.innerHTML = (isFilter ? '<option value="">All Categories</option>' : '<option value="">Select category…</option>') +
      state.categories.map(c => `<option value="${c.id}">${c.icon||''} ${esc(c.name)}</option>`).join('');
    sel.value = current;
  });
}

// ──────────────────────────────────────────────────────────────
//  6.  STOCK MANAGEMENT
// ──────────────────────────────────────────────────────────────
function openStockModal(type, productId = null) {
  $('stock-txn-form').reset();
  $('txn-type').value   = type;
  $('txn-current-stock').value = '';
  const adjustWrap = $('txn-adjust-wrap');

  const titles = { stock_in:'Stock In', stock_out:'Stock Out', adjustment:'Stock Adjustment' };
  $('modal-txn-title').textContent = titles[type] || 'Stock Transaction';

  // Populate product dropdown
  const sel = $('txn-product');
  sel.innerHTML = '<option value="">Select product…</option>' +
    state.products.map(p =>
      `<option value="${p.id}">${esc(p.name)} (${p.quantity||0} ${p.unit||''})</option>`
    ).join('');

  if (productId) sel.value = productId;
  updateTxnCurrentStock();

  // Show/hide adjustment field
  if (adjustWrap) adjustWrap.style.display = type === 'adjustment' ? 'block' : 'none';

  // Set default datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('txn-date').value = now.toISOString().slice(0,16);

  // Update save button
  const btn = $('btn-save-txn');
  const btnColors = { stock_in:'btn-success', stock_out:'btn-danger', adjustment:'btn-warning' };
  btn.className = `btn ${btnColors[type]||'btn-primary'}`;

  openModal('modal-stock-txn');
  if (!productId) $('txn-product').focus();
}

window.openStockModal = openStockModal;

function updateTxnCurrentStock() {
  const pid   = $('txn-product')?.value;
  const prod  = state.products.find(p => p.id === pid);
  $('txn-current-stock').value = prod ? prod.quantity || 0 : '';
}

async function saveStockTransaction() {
  const type   = $('txn-type').value;
  const pid    = $('txn-product').value;
  const prod   = state.products.find(p => p.id === pid);

  // Validate
  let valid = true;
  if (!pid) { $('err-txn-product').classList.add('show'); valid = false; }
  else { $('err-txn-product').classList.remove('show'); }

  const qtyInput = $('txn-qty');
  const qty      = Number(qtyInput.value);
  if (!qty || qty < 1) {
    if (type !== 'adjustment') { $('err-txn-qty').classList.add('show'); valid = false; }
  } else {
    $('err-txn-qty').classList.remove('show');
  }
  if (!valid) return;

  if (!prod) { toast('Product not found.', 'error'); return; }

  const currentQty = Number(prod.quantity) || 0;
  let   newQty     = currentQty;
  let   changeQty  = qty;

  if (type === 'stock_in') {
    newQty = currentQty + qty;
  } else if (type === 'stock_out') {
    if (qty > currentQty) {
      toast(`Cannot remove more than current stock (${currentQty}).`, 'warning');
      return;
    }
    newQty    = currentQty - qty;
    changeQty = -qty;
  } else if (type === 'adjustment') {
    const newVal = Number($('txn-new-qty').value);
    if (isNaN(newVal) || newVal < 0) {
      toast('Enter a valid new stock value for adjustment.', 'warning'); return;
    }
    changeQty = newVal - currentQty;
    newQty    = newVal;
  }

  const txnData = {
    type,
    productId:   pid,
    productName: prod.name,
    quantity:    Math.abs(changeQty),
    qtyBefore:   currentQty,
    qtyAfter:    newQty,
    reference:   $('txn-ref').value.trim(),
    note:        $('txn-ref').value.trim(),
    createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
    createdBy:   state.user.uid,
    createdByName: state.userProfile?.name || state.user.email
  };

  const btn = $('btn-save-txn');
  btn.disabled = true;

  try {
    const batch = db.batch();
    const txnRef  = db.collection('transactions').doc();
    const prodRef = db.collection('products').doc(pid);
    batch.set(txnRef, txnData);
    batch.update(prodRef, {
      quantity:  newQty,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: state.user.uid
    });
    await batch.commit();
    toast(`Stock ${type.replace('_',' ')} recorded successfully.`);
    closeModal('modal-stock-txn');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderTransactionTable() {
  const search  = ($('txn-search')?.value  || '').toLowerCase();
  const typeF   = $('txn-filter-type')?.value  || '';
  const dateF   = $('txn-filter-date')?.value  || '';

  let txns = state.transactions.filter(t => {
    const matchS = !search || t.productName?.toLowerCase().includes(search)
                            || t.reference?.toLowerCase().includes(search);
    const matchT = !typeF  || t.type === typeF;
    let   matchD = true;
    if (dateF && t.createdAt) {
      const td = (t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt));
      matchD = td.toISOString().slice(0,10) === dateF;
    }
    return matchS && matchT && matchD;
  });

  const tbody = $('txn-tbody');
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><p>No transactions found.</p></div></td></tr>`;
    return;
  }

  const typeLabels = { stock_in:'Stock In', stock_out:'Stock Out', adjustment:'Adjustment' };
  const typeColors = { stock_in:'badge-success', stock_out:'badge-danger', adjustment:'badge-warning' };

  tbody.innerHTML = txns.map(t => `<tr>
    <td style="white-space:nowrap;font-size:.8rem;">${fmtDate(t.createdAt)}</td>
    <td><span class="badge ${typeColors[t.type]||'badge-gray'}">${typeLabels[t.type]||t.type}</span></td>
    <td style="font-weight:600;">${esc(t.productName||'–')}</td>
    <td style="font-weight:700;color:${t.type==='stock_in'?'var(--success)':t.type==='stock_out'?'var(--danger)':'var(--warning)'};">
      ${t.type==='stock_in'?'+':t.type==='stock_out'?'-':'±'}${t.quantity}
    </td>
    <td>${t.qtyBefore ?? '–'}</td>
    <td>${t.qtyAfter  ?? '–'}</td>
    <td style="font-size:.8rem;color:var(--text-muted);">${esc(t.reference||'–')}</td>
    <td style="font-size:.8rem;">${esc(t.createdByName||'–')}</td>
  </tr>`).join('');

  // Also render low-stock tab
  renderLowStockTable();
}

function renderLowStockTable() {
  const tbody = $('low-tbody');
  if (!tbody) return;
  const items = state.products.filter(p => {
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    return qty <= min;
  });
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">✅</div><p>All products are well-stocked.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(p => {
    const cat = state.categories.find(c => c.id === p.categoryId);
    const qty = Number(p.quantity) || 0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    const st  = stockStatus(qty, min);
    return `<tr class="${st.row}">
      <td style="font-weight:600;">${esc(p.name)}</td>
      <td><code style="font-size:.78rem;background:#f1f5f9;padding:.15rem .4rem;border-radius:4px;">${esc(p.sku||'–')}</code></td>
      <td>${cat ? esc(cat.name) : '–'}</td>
      <td style="font-weight:700;color:${qty<=0?'var(--danger)':'var(--warning)'};">${qty}</td>
      <td>${min}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>
        <button class="btn btn-sm btn-success" onclick="openStockModal('stock_in','${p.id}')">
          <i class="fa fa-plus"></i> Stock In
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ──────────────────────────────────────────────────────────────
//  7.  SUPPLIERS
// ──────────────────────────────────────────────────────────────
function renderSuppliersTable() {
  const search  = ($('sup-search')?.value  || '').toLowerCase();
  const statusF = $('sup-filter-status')?.value || '';

  let sups = state.suppliers.filter(s => {
    const matchS = !search || s.name?.toLowerCase().includes(search)
                            || s.contact?.toLowerCase().includes(search)
                            || s.email?.toLowerCase().includes(search);
    const matchSt = !statusF || s.status === statusF;
    return matchS && matchSt;
  });

  const tbody = $('sup-tbody');
  if (!sups.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🚚</div><h4>No suppliers found</h4><p>Click "Add Supplier" to begin.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sups.map(s => {
    const productCount = state.products.filter(p => p.supplierId === s.id).length;
    return `<tr>
      <td>
        <div style="font-weight:700;">${esc(s.name)}</div>
        ${s.paymentTerms ? `<div style="font-size:.75rem;color:var(--text-muted);">${esc(s.paymentTerms)}</div>` : ''}
      </td>
      <td>${esc(s.contact||'–')}</td>
      <td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : '–'}</td>
      <td>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '–'}</td>
      <td style="font-size:.8rem;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.address||'–')}</td>
      <td><span class="badge badge-info">${productCount}</span></td>
      <td><span class="badge ${s.status==='active'?'badge-success':'badge-gray'}">${s.status||'active'}</span></td>
      <td>
        <div style="display:flex;gap:.4rem;">
          <button class="btn btn-sm btn-outline btn-icon" onclick="editSupplier('${s.id}')" title="Edit" aria-label="Edit ${esc(s.name)}">
            <i class="fa fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon" onclick="confirmDelete('supplier','${s.id}','${esc(s.name)}')" title="Delete" aria-label="Delete ${esc(s.name)}">
            <i class="fa fa-trash" style="color:var(--danger)"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openSupplierModal(id = null) {
  $('supplier-form').reset();
  $('sup-id').value = '';
  $('modal-sup-title').textContent = id ? 'Edit Supplier' : 'Add Supplier';

  if (id) {
    const s = state.suppliers.find(x => x.id === id);
    if (!s) return;
    $('sup-id').value      = id;
    $('sup-name').value    = s.name    || '';
    $('sup-contact').value = s.contact || '';
    $('sup-phone').value   = s.phone   || '';
    $('sup-email').value   = s.email   || '';
    $('sup-address').value = s.address || '';
    $('sup-terms').value   = s.paymentTerms || '';
    $('sup-status').value  = s.status  || 'active';
    $('sup-notes').value   = s.notes   || '';
  }
  openModal('modal-supplier');
  $('sup-name').focus();
}

window.editSupplier = id => openSupplierModal(id);

async function saveSupplier() {
  const name = $('sup-name').value.trim();
  if (!name) {
    $('err-sup-name').classList.add('show');
    $('sup-name').focus();
    return;
  }
  $('err-sup-name').classList.remove('show');

  const id   = $('sup-id').value;
  const data = {
    name,
    contact:      $('sup-contact').value.trim(),
    phone:        $('sup-phone').value.trim(),
    email:        $('sup-email').value.trim(),
    address:      $('sup-address').value.trim(),
    paymentTerms: $('sup-terms').value.trim(),
    status:       $('sup-status').value,
    notes:        $('sup-notes').value.trim(),
    updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
  };

  const btn = $('btn-save-supplier');
  btn.disabled = true;

  try {
    if (id) {
      await db.collection('suppliers').doc(id).update(data);
      toast('Supplier updated.');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('suppliers').add(data);
      toast('Supplier added.');
    }
    closeModal('modal-supplier');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function populateSupplierDropdowns() {
  const sel = $('p-supplier');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select supplier…</option>' +
    state.suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.value = current;
}

// ──────────────────────────────────────────────────────────────
//  8.  REPORTS
// ──────────────────────────────────────────────────────────────
function renderReportSummary() {
  const stats = $('rep-summary-stats');
  if (!stats) return;

  const products   = state.products;
  const totalValue = products.reduce((s,p) => s+(Number(p.quantity)||0)*(Number(p.price)||0), 0);
  const totalCost  = products.reduce((s,p) => s+(Number(p.quantity)||0)*(Number(p.cost)||0), 0);
  const potProfit  = totalValue - totalCost;
  const lowCount   = products.filter(p => {
    const qty = Number(p.quantity)||0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    return qty <= min;
  }).length;

  stats.innerHTML = [
    { label:'Total Products',    value: products.length, icon:'fa-boxes-stacked', bg:'#eff6ff', col:'#2563eb' },
    { label:'Total Stock Value', value: currency(totalValue), icon:'fa-peso-sign',   bg:'#f0fdf4', col:'#22c55e' },
    { label:'Total Cost Value',  value: currency(totalCost),  icon:'fa-coins',       bg:'#fef3c7', col:'#f59e0b' },
    { label:'Potential Profit',  value: currency(potProfit),  icon:'fa-chart-line',  bg:'#fdf4ff', col:'#a855f7' },
    { label:'Low / Out of Stock',value: lowCount,             icon:'fa-triangle-exclamation', bg:'#fef2f2', col:'#ef4444' },
    { label:'Total Categories',  value: state.categories.length, icon:'fa-tags',    bg:'#f0f9ff', col:'#0ea5e9' }
  ].map(s => `<div class="stat-card">
    <div class="stat-top">
      <div>
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
      <div class="stat-icon" style="background:${s.bg};color:${s.col}"><i class="fa ${s.icon}"></i></div>
    </div>
  </div>`).join('');

  renderValuationTable();
  renderMovementTable();
  renderRepLowStockTable();
  renderOverviewChart();
}

function renderOverviewChart() {
  const canvas = $('rep-chart-overview');
  if (!canvas) return;

  const cats   = state.categories;
  const labels = cats.map(c => c.name);
  const vals   = cats.map(c =>
    state.products.filter(p => p.categoryId === c.id)
      .reduce((s,p) => s+(Number(p.quantity)||0)*(Number(p.price)||0), 0)
  );

  if (state.charts.repOverview) state.charts.repOverview.destroy();
  state.charts.repOverview = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Stock Value (₱)', data: vals, backgroundColor: generateColors(cats.length), borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position:'top' } },
      scales: {
        y: { beginAtZero:true, ticks: { callback: v => `₱${(v/1000).toFixed(0)}k` } }
      }
    }
  });
}

function renderValuationTable() {
  const tbody = $('val-tbody');
  if (!tbody) return;
  const rows = state.products.map(p => {
    const cat   = state.categories.find(c => c.id === p.categoryId);
    const qty   = Number(p.quantity) || 0;
    const cost  = Number(p.cost)  || 0;
    const price = Number(p.price) || 0;
    const val   = qty * price;
    const profit= qty * (price - cost);
    return { p, cat, qty, cost, price, val, profit };
  }).sort((a,b) => b.val - a.val);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No products to show.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td style="font-weight:600;">${esc(r.p.name)}</td>
    <td><code style="font-size:.75rem;background:#f1f5f9;padding:.15rem .4rem;border-radius:4px;">${esc(r.p.sku||'–')}</code></td>
    <td>${r.cat ? esc(r.cat.name) : '–'}</td>
    <td>${r.qty.toLocaleString()}</td>
    <td>${currency(r.cost)}</td>
    <td>${currency(r.price)}</td>
    <td style="font-weight:700;">${currency(r.val)}</td>
    <td style="font-weight:700;color:${r.profit>=0?'var(--success)':'var(--danger)'};">${currency(r.profit)}</td>
  </tr>`).join('');
}

function renderMovementTable() {
  const tbody   = $('mov-tbody');
  if (!tbody) return;
  const txns    = state.transactions.slice(0,100);
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No transactions recorded.</p></div></td></tr>`;
    return;
  }
  const typeLabels = { stock_in:'Stock In', stock_out:'Stock Out', adjustment:'Adjustment' };
  const typeColors = { stock_in:'badge-success', stock_out:'badge-danger', adjustment:'badge-warning' };
  tbody.innerHTML = txns.map(t => `<tr>
    <td style="font-size:.8rem;white-space:nowrap;">${fmtDateShort(t.createdAt)}</td>
    <td style="font-weight:600;">${esc(t.productName||'–')}</td>
    <td><span class="badge ${typeColors[t.type]||'badge-gray'}">${typeLabels[t.type]||t.type}</span></td>
    <td style="font-weight:700;color:${t.type==='stock_in'?'var(--success)':t.type==='stock_out'?'var(--danger)':'var(--warning)'};">
      ${t.type==='stock_in'?'+':t.type==='stock_out'?'-':'±'}${t.quantity}
    </td>
    <td style="font-size:.8rem;color:var(--text-muted);">${esc(t.reference||'–')}</td>
    <td style="font-size:.8rem;">${esc(t.createdByName||'–')}</td>
  </tr>`).join('');
}

function renderRepLowStockTable() {
  const tbody = $('rep-low-tbody');
  if (!tbody) return;
  const items = state.products.filter(p => {
    const qty = Number(p.quantity)||0;
    const min = p.minStock || state.storeSettings.threshold || 10;
    return qty <= min;
  });
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">✅</div><p>No low-stock items.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(p => {
    const cat      = state.categories.find(c => c.id === p.categoryId);
    const qty      = Number(p.quantity)||0;
    const min      = p.minStock || state.storeSettings.threshold || 10;
    const shortage = Math.max(0, min - qty);
    const st       = stockStatus(qty, min);
    return `<tr class="${st.row}">
      <td style="font-weight:600;">${esc(p.name)}</td>
      <td>${cat ? esc(cat.name) : '–'}</td>
      <td style="font-weight:700;color:${qty<=0?'var(--danger)':'var(--warning)'};">${qty}</td>
      <td>${min}</td>
      <td style="font-weight:700;color:var(--danger);">${shortage}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
    </tr>`;
  }).join('');
}

// ──────────────────────────────────────────────────────────────
//  9.  SETTINGS
// ──────────────────────────────────────────────────────────────
function loadSettingsPage() {
  // Store info
  const s = state.storeSettings;
  $('store-name').value     = s.name     || '';
  $('store-code').value     = s.code     || '';
  $('store-address').value  = s.address  || '';
  $('store-phone').value    = s.phone    || '';
  $('store-email').value    = s.email    || '';
  $('store-currency').value = s.currency || '₱';
  $('store-threshold').value= s.threshold|| 10;

  // Profile tab
  const u = state.user;
  const p = state.userProfile;
  $('profile-name').value           = p?.name  || u?.displayName || '';
  $('profile-phone').value          = p?.phone || '';
  $('profile-email-display').textContent = u?.email || '–';
  $('profile-role-display').textContent  = p?.role  || 'staff';
  $('profile-avatar').textContent        = (p?.name || u?.email || 'U').charAt(0).toUpperCase();
  $('session-info').textContent          = `Logged in as: ${u?.email || '–'}`;

  // Email verification
  if (u?.emailVerified) {
    $('email-verified-status').innerHTML = '<span style="color:var(--success);font-weight:600;"><i class="fa fa-circle-check"></i> Verified</span>';
    $('btn-verify-email').style.display  = 'none';
  } else {
    $('email-verified-status').innerHTML = '<span style="color:var(--warning);font-weight:600;"><i class="fa fa-triangle-exclamation"></i> Not verified</span>';
    $('btn-verify-email').style.display  = 'inline-flex';
  }

  // Load users list
  loadUsersList();
}

async function loadUsersList() {
  const tbody = $('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-muted);">Loading users…</td></tr>`;
  try {
    const snap = await db.collection('users').orderBy('name').get();
    const users = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><p>No users found.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = users.map(u => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:.625rem;">
          <div class="user-avatar" style="width:32px;height:32px;font-size:.8rem;flex-shrink:0;">${(u.name||'U').charAt(0).toUpperCase()}</div>
          <div style="font-weight:600;">${esc(u.name||'–')}</div>
        </div>
      </td>
      <td style="font-size:.8rem;">${esc(u.email||'–')}</td>
      <td><span class="badge ${u.role==='admin'?'badge-danger':u.role==='manager'?'badge-warning':'badge-info'}">${u.role||'staff'}</span></td>
      <td><span class="badge badge-success">Active</span></td>
      <td style="font-size:.8rem;color:var(--text-muted);">${fmtDateShort(u.lastLogin)}</td>
      <td>
        ${u.id !== state.user.uid ? `
        <div style="display:flex;gap:.4rem;">
          <button class="btn btn-sm btn-ghost btn-icon" onclick="changeUserRole('${u.id}','${u.role}')" title="Change role">
            <i class="fa fa-shield-halved"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon" onclick="confirmDelete('user','${u.id}','${esc(u.name||u.email)}')" title="Remove">
            <i class="fa fa-trash" style="color:var(--danger)"></i>
          </button>
        </div>` : '<span style="font-size:.75rem;color:var(--text-muted);">You</span>'}
      </td>
    </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>Error loading users.</p></div></td></tr>`;
  }
}

window.changeUserRole = async (uid, currentRole) => {
  const roles    = ['staff','manager','admin'];
  const roleLabels = { staff:'Staff', manager:'Manager', admin:'Admin' };
  const idx  = roles.indexOf(currentRole);
  const next = roles[(idx + 1) % roles.length];
  try {
    await db.collection('users').doc(uid).update({ role: next });
    toast(`Role updated to ${roleLabels[next]}.`);
    loadUsersList();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
};

async function saveStoreSettings(e) {
  e.preventDefault();
  const data = {
    name:      $('store-name').value.trim(),
    code:      $('store-code').value.trim(),
    address:   $('store-address').value.trim(),
    phone:     $('store-phone').value.trim(),
    email:     $('store-email').value.trim(),
    currency:  $('store-currency').value.trim() || '₱',
    threshold: Number($('store-threshold').value) || 10,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('settings').doc('store').set(data, { merge: true });
    Object.assign(state.storeSettings, data);
    toast('Store settings saved.');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

async function updateProfile(e) {
  e.preventDefault();
  const name  = $('profile-name').value.trim();
  const phone = $('profile-phone').value.trim();
  try {
    await db.collection('users').doc(state.user.uid).update({ name, phone,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await state.user.updateProfile({ displayName: name });
    if (state.userProfile) { state.userProfile.name = name; state.userProfile.phone = phone; }
    $('user-display-name').textContent = name;
    $('user-avatar').textContent       = name.charAt(0).toUpperCase();
    toast('Profile updated.');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

async function changePassword(e) {
  e.preventDefault();
  const curPw  = $('cur-pw').value;
  const newPw  = $('new-pw').value;
  const confPw = $('confirm-pw').value;

  if (newPw.length < 8) { toast('Password must be at least 8 characters.', 'warning'); return; }
  if (newPw !== confPw) { toast('Passwords do not match.',  'warning'); return; }

  try {
    // Re-authenticate first
    const cred = firebase.auth.EmailAuthProvider.credential(state.user.email, curPw);
    await state.user.reauthenticateWithCredential(cred);
    await state.user.updatePassword(newPw);
    $('change-pw-form').reset();
    toast('Password changed successfully.');
  } catch (e) {
    const map = {
      'auth/wrong-password':       'Current password is incorrect.',
      'auth/weak-password':        'Password is too weak.',
      'auth/requires-recent-login':'Please log out and log in again before changing your password.'
    };
    toast(map[e.code] || e.message, 'error');
  }
}

async function inviteUser() {
  const name  = $('inv-name').value.trim();
  const email = $('inv-email').value.trim();
  const pw    = $('inv-pw').value;
  const role  = $('inv-role').value;

  if (!name || !email || !pw) { toast('All fields are required.', 'warning'); return; }
  if (pw.length < 8) { toast('Password must be at least 8 characters.', 'warning'); return; }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Invalid email address.', 'warning'); return; }

  const btn = $('btn-save-invite');
  btn.disabled = true;

  try {
    // Create secondary Auth instance to avoid signing out current user
    const secondaryApp = firebase.initializeApp(firebase.app().options, `invite_${Date.now()}`);
    const secAuth = secondaryApp.auth();
    const cred = await secAuth.createUserWithEmailAndPassword(email, pw);
    await secAuth.signOut();
    await secondaryApp.delete();

    // Save profile in Firestore
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid, name, email, role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: state.user.uid
    });

    toast(`User ${name} created successfully.`);
    closeModal('modal-invite-user');
    loadUsersList();
  } catch (e) {
    const map = {
      'auth/email-already-in-use': 'That email is already registered.',
      'auth/invalid-email':        'Invalid email address.'
    };
    toast(map[e.code] || e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ──────────────────────────────────────────────────────────────
//  10.  CONFIRM DELETE / GENERIC DELETE
// ──────────────────────────────────────────────────────────────
window.confirmDelete = (type, id, name) => {
  $('confirm-title').textContent   = `Delete ${type.charAt(0).toUpperCase()+type.slice(1)}`;
  $('confirm-message').textContent = `Are you sure you want to delete "${name}"? This action cannot be undone.`;
  state.confirmCallback = () => doDelete(type, id);
  openModal('modal-confirm');
};

async function doDelete(type, id) {
  closeModal('modal-confirm');
  try {
    const colMap = { product:'products', category:'categories', supplier:'suppliers', user:'users' };
    await db.collection(colMap[type]).doc(id).delete();
    toast(`${type.charAt(0).toUpperCase()+type.slice(1)} deleted.`, 'warning');
    if (type === 'user') loadUsersList();
  } catch (e) {
    toast(`Error deleting: ${e.message}`, 'error');
  }
}

// ──────────────────────────────────────────────────────────────
//  11.  PRINT REPORT
// ──────────────────────────────────────────────────────────────
function printReport() {
  window.print();
}

// ──────────────────────────────────────────────────────────────
//  12.  GLOBAL SEARCH
// ──────────────────────────────────────────────────────────────
function doGlobalSearch(query) {
  if (!query) return;
  const q = query.toLowerCase();
  const match = state.products.some(p =>
    p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  if (match) {
    navigateTo('inventory');
    setTimeout(() => {
      $('inv-search').value = query;
      renderInventoryTable();
    }, 100);
  }
}

// ──────────────────────────────────────────────────────────────
//  13.  EVENT LISTENERS
// ──────────────────────────────────────────────────────────────
let listenersInitialized = false;

function initAppListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  /* ── Navigation ── */
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  /* ── Sidebar mobile toggle ── */
  $('btn-menu-toggle')?.addEventListener('click', openSidebar);
  $('sidebar-overlay')?.addEventListener('click', closeSidebar);

  /* ── Logout ── */
  $('btn-logout')?.addEventListener('click', async () => {
    stopListeners();
    await auth.signOut();
    if (typeof showLogin === 'function') showLogin();
  });

  /* ── Global search ── */
  $('global-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doGlobalSearch(e.target.value.trim());
  });

  /* ── Refresh button ── */
  $('btn-refresh')?.addEventListener('click', () => {
    const active = document.querySelector('.nav-item.active');
    if (active) navigateTo(active.dataset.page);
    toast('Data refreshed.', 'info', 2000);
  });

  /* ── Quick add (Dashboard) ── */
  $('btn-quick-add-product')?.addEventListener('click', () => openProductModal());

  /* ── Product modal ── */
  $('btn-add-product')?.addEventListener('click',  () => openProductModal());
  $('btn-save-product')?.addEventListener('click', saveProduct);

  /* ── Category modal ── */
  $('btn-add-category')?.addEventListener('click',  () => openCategoryModal());
  $('btn-save-category')?.addEventListener('click', saveCategory);
  $('cat-search')?.addEventListener('input', renderCategoryCards);

  /* ── Inventory filters ── */
  $('inv-search')?.addEventListener('input', renderInventoryTable);
  $('inv-filter-category')?.addEventListener('change', renderInventoryTable);
  $('inv-filter-status')?.addEventListener('change', renderInventoryTable);
  $('btn-export-inv')?.addEventListener('click', exportInventory);

  /* ── Stock transaction ── */
  $('btn-stock-in')?.addEventListener('click',     () => openStockModal('stock_in'));
  $('btn-stock-out')?.addEventListener('click',    () => openStockModal('stock_out'));
  $('btn-adjust-stock')?.addEventListener('click', () => openStockModal('adjustment'));
  $('btn-save-txn')?.addEventListener('click',     saveStockTransaction);
  $('txn-product')?.addEventListener('change',     updateTxnCurrentStock);

  /* ── Transaction filters ── */
  $('txn-search')?.addEventListener('input',       renderTransactionTable);
  $('txn-filter-type')?.addEventListener('change', renderTransactionTable);
  $('txn-filter-date')?.addEventListener('change', renderTransactionTable);

  /* ── Supplier modal ── */
  $('btn-add-supplier')?.addEventListener('click',  () => openSupplierModal());
  $('btn-save-supplier')?.addEventListener('click', saveSupplier);
  $('sup-search')?.addEventListener('input',        renderSuppliersTable);
  $('sup-filter-status')?.addEventListener('change',renderSuppliersTable);

  /* ── Reports ── */
  $('btn-print-report')?.addEventListener('click', printReport);
  $('btn-apply-dates')?.addEventListener('click',  renderReportSummary);

  /* ── Settings forms ── */
  $('store-info-form')?.addEventListener('submit', saveStoreSettings);
  $('profile-form')?.addEventListener('submit',    updateProfile);
  $('change-pw-form')?.addEventListener('submit',  changePassword);
  $('btn-invite-user')?.addEventListener('click',  () => openModal('modal-invite-user'));
  $('btn-save-invite')?.addEventListener('click',  inviteUser);

  $('btn-verify-email')?.addEventListener('click', async () => {
    try {
      await state.user.sendEmailVerification();
      toast('Verification email sent. Check your inbox.', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('btn-revoke-session')?.addEventListener('click', async () => {
    stopListeners();
    await auth.signOut();
    window.location.href = 'index.html';
  });

  /* ── Confirm delete button ── */
  $('btn-confirm-delete')?.addEventListener('click', () => {
    if (state.confirmCallback) { state.confirmCallback(); state.confirmCallback = null; }
  });

  /* ── Close modals (data-close attribute) ── */
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });

  /* ── Close modal on overlay click ── */
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  /* ── Tabs (generic) ── */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      const parent  = btn.closest('.page-section') || btn.closest('section') || document;

      // Deactivate sibling tab buttons
      btn.closest('.tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide panels
      parent.querySelectorAll('.tab-panel').forEach(panel => {
        panel.style.display = panel.id === `tab-${tabName}` ? 'block' : 'none';
      });

      // Trigger sub-renders
      if (tabName === 'lowstock')      renderLowStockTable();
      if (tabName === 'rep-valuation') renderValuationTable();
      if (tabName === 'rep-movement')  renderMovementTable();
      if (tabName === 'rep-lowstock')  renderRepLowStockTable();
      if (tabName === 'set-users')     loadUsersList();
      if (tabName === 'set-profile')   loadSettingsPage();
    });
  });

  /* ── Keyboard: Escape closes modals ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal-overlay.open');
      if (open) closeModal(open.id);
    }
  });
});

// Make navigateTo available globally (used in inline onclick)
window.navigateTo = navigateTo;

// Global sign out function
window.signOut = async function() {
  stopListeners();
  await auth.signOut();
  if (typeof showLogin === 'function') showLogin();
};
