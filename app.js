/* =============================================
   BATCH RECORD — Core Application Logic
   Cloud Sync via Firebase Firestore
   Handles: CRUD, Navigation, Calculations, Sync
   ============================================= */

(function () {
  'use strict';

  // ── Default expense categories ──
  const DEFAULT_CATEGORIES = [
    'Casted', 'Runner', 'Cutting', 'Stone', 'Fitting', 'Plating'
  ];

  // ── Firestore reference (safe init) ──
  const hasFirestore = typeof window.db !== 'undefined';
  const batchesRef = hasFirestore ? window.db.collection('batches') : null;

  // ── State ──
  let batches = [];
  let editingBatchId = null;
  let currentSort = 'date-desc';
  let customCategoryCount = 0;

  // ── DOM Elements ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    dashboard: $('#screenDashboard'),
    form: $('#screenForm'),
    history: $('#screenHistory'),
    detail: $('#screenDetail')
  };

  // ── Init ──
  function init() {
    setTodayDate();
    buildExpenseRows();
    bindEvents();
    if (hasFirestore) {
      listenToBatches(); // Real-time Firestore listener
    } else {
      // Fallback: no Firebase, use localStorage
      console.warn('Firebase not available — using local storage');
      loadLocalData();
      renderDashboard();
    }
    registerSW();
  }

  // ── Service Worker ──
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ── Firestore: Real-time Listener ──
  // This listens for ALL changes (add/edit/delete) from any device
  function listenToBatches() {
    batchesRef.orderBy('createdAt', 'desc').onSnapshot(
      (snapshot) => {
        batches = [];
        snapshot.forEach((doc) => {
          batches.push({ id: doc.id, ...doc.data() });
        });
        // Re-render whatever screen is currently active
        renderDashboard();
        if (screens.history.classList.contains('active')) {
          renderHistory();
        }
        if (screens.detail.classList.contains('active') && editingBatchId) {
          const updated = batches.find((b) => b.id === editingBatchId);
          if (updated) openDetail(updated.id);
        }
      },
      (error) => {
        console.error('Firestore listen error:', error);
        showToast('Sync error — using local data');
        // Fallback to localStorage
        loadLocalData();
        renderDashboard();
      }
    );
  }

  // ── LocalStorage fallback ──
  function loadLocalData() {
    try {
      const raw = localStorage.getItem('batchRecordData');
      batches = raw ? JSON.parse(raw) : [];
    } catch {
      batches = [];
    }
  }

  function saveLocalBackup() {
    localStorage.setItem('batchRecordData', JSON.stringify(batches));
  }

  // ── Navigation ──
  function showScreen(screenId) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[screenId].classList.add('active');

    // Update nav active state
    $$('.nav-item').forEach((n) => n.classList.remove('active'));
    if (screenId === 'dashboard') {
      $('#navDashboard').classList.add('active');
    } else if (screenId === 'history') {
      $('#navHistory').classList.add('active');
    }

    // Show/hide bottom nav on detail/form screens
    const nav = $('#bottomNav');
    if (screenId === 'detail' || screenId === 'form') {
      nav.style.display = 'none';
    } else {
      nav.style.display = 'flex';
    }
  }

  // ── Events ──
  function bindEvents() {
    // Navigation
    $('#navDashboard').addEventListener('click', () => {
      showScreen('dashboard');
      renderDashboard();
    });

    $('#navHistory').addEventListener('click', () => {
      showScreen('history');
      renderHistory();
    });

    $('#navNewBatch').addEventListener('click', () => openNewBatchForm());

    // Form
    $('#formBackBtn').addEventListener('click', () => {
      showScreen('dashboard');
      renderDashboard();
    });

    $('#addExpenseBtn').addEventListener('click', addCustomExpenseRow);
    $('#saveBatchBtn').addEventListener('click', saveBatch);
    $('#sellingPrice').addEventListener('input', recalcTotals);

    // Detail
    $('#detailBackBtn').addEventListener('click', () => {
      showScreen('history');
      renderHistory();
    });

    $('#editBatchBtn').addEventListener('click', () => {
      if (editingBatchId) openEditBatchForm(editingBatchId);
    });

    $('#deleteBatchBtn').addEventListener('click', () => {
      $('#deleteModal').classList.remove('hidden');
    });

    // Delete modal
    $('#cancelDeleteBtn').addEventListener('click', () => {
      $('#deleteModal').classList.add('hidden');
    });

    $('#confirmDeleteBtn').addEventListener('click', () => {
      deleteBatch(editingBatchId);
      $('#deleteModal').classList.add('hidden');
      showScreen('history');
      renderHistory();
    });

    // Search
    $('#searchInput').addEventListener('input', renderHistory);

    // Sort chips
    $$('.sort-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $$('.sort-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        currentSort = chip.dataset.sort;
        renderHistory();
      });
    });

    // Export
    $('#headerActionBtn').addEventListener('click', exportData);
  }

  // ── Expense Row Builder ──
  function buildExpenseRows(expenses) {
    const container = $('#expenseRows');
    container.innerHTML = '';
    customCategoryCount = 0;

    if (expenses && expenses.length > 0) {
      expenses.forEach((exp) => {
        const isDefault = DEFAULT_CATEGORIES.includes(exp.name);
        addExpenseRowToDOM(exp.name, exp.amount, !isDefault);
      });
    } else {
      DEFAULT_CATEGORIES.forEach((cat) => {
        addExpenseRowToDOM(cat, '', false);
      });
    }
  }

  function addExpenseRowToDOM(name, amount, isCustom) {
    const container = $('#expenseRows');
    const row = document.createElement('div');
    row.className = 'expense-row';

    if (isCustom) {
      row.innerHTML = `
        <input class="expense-input" style="flex:0 0 90px; font-size:0.82rem; padding:10px;" 
               type="text" value="${escapeHtml(name)}" placeholder="Category" data-custom="true">
        <input class="expense-input expense-amount" type="number" inputmode="numeric" 
               value="${amount || ''}" placeholder="₹ 0">
        <button class="expense-remove" type="button" title="Remove">✕</button>
      `;
      row.querySelector('.expense-remove').addEventListener('click', () => {
        row.remove();
        recalcTotals();
      });
    } else {
      row.innerHTML = `
        <span class="expense-label">${escapeHtml(name)}</span>
        <input class="expense-input expense-amount" type="number" inputmode="numeric" 
               value="${amount || ''}" placeholder="₹ 0" data-category="${escapeHtml(name)}">
      `;
    }

    container.appendChild(row);

    row.querySelectorAll('.expense-amount').forEach((inp) => {
      inp.addEventListener('input', recalcTotals);
    });
  }

  function addCustomExpenseRow() {
    customCategoryCount++;
    addExpenseRowToDOM(`Custom ${customCategoryCount}`, '', true);
  }

  // ── Recalculate Totals ──
  function recalcTotals() {
    const totalCost = getExpensesFromForm().reduce((sum, e) => sum + e.amount, 0);
    const sellingPrice = parseFloat($('#sellingPrice').value) || 0;
    const profitLoss = sellingPrice - totalCost;
    const profitPct = totalCost > 0 ? ((profitLoss / totalCost) * 100) : 0;

    $('#formTotalCost').innerHTML = `<span class="rupee">₹</span>${formatNum(totalCost)}`;

    const plEl = $('#formProfitLoss');
    plEl.innerHTML = `<span class="rupee">₹</span>${formatNum(Math.abs(profitLoss))}`;
    plEl.className = 'total-value ' + (profitLoss >= 0 ? 'profit' : 'loss');
    if (sellingPrice > 0) {
      plEl.innerHTML = (profitLoss >= 0 ? '+' : '-') + ` <span class="rupee">₹</span>${formatNum(Math.abs(profitLoss))}`;
    }

    const pctEl = $('#formProfitPct');
    pctEl.textContent = (sellingPrice > 0 ? profitPct.toFixed(1) : '0') + '%';
    pctEl.className = 'total-value ' + (profitLoss >= 0 ? 'profit' : 'loss');
  }

  // ── Get Expenses From Form ──
  function getExpensesFromForm() {
    const expenses = [];
    const rows = $$('#expenseRows .expense-row');
    rows.forEach((row) => {
      const customInput = row.querySelector('[data-custom="true"]');
      const label = row.querySelector('.expense-label');
      const amountInput = row.querySelector('.expense-amount');

      let name = '';
      if (customInput) {
        name = customInput.value.trim();
      } else if (label) {
        name = label.textContent.trim();
      }

      const amount = parseFloat(amountInput?.value) || 0;
      if (name) {
        expenses.push({ name, amount });
      }
    });
    return expenses;
  }

  // ── Open Form ──
  function openNewBatchForm() {
    editingBatchId = null;
    $('#formTitle').textContent = 'New Batch';
    $('#formSubtitle').textContent = 'Add batch expenses';
    $('#batchName').value = '';
    setTodayDate();
    $('#sellingPrice').value = '';
    buildExpenseRows();
    recalcTotals();
    $('#saveBatchBtn').innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Save Batch`;
    showScreen('form');
  }

  function openEditBatchForm(id) {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    editingBatchId = id;
    $('#formTitle').textContent = 'Edit Batch';
    $('#formSubtitle').textContent = batch.name;
    $('#batchName').value = batch.name;
    $('#batchDate').value = batch.date;
    $('#sellingPrice').value = batch.sellingPrice || '';
    buildExpenseRows(batch.expenses);
    recalcTotals();
    $('#saveBatchBtn').innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Update Batch`;
    showScreen('form');
  }

  // ── Save / Update Batch (Firestore) ──
  function saveBatch() {
    const name = $('#batchName').value.trim();
    const date = $('#batchDate').value;

    if (!name) {
      showToast('Please enter batch name');
      $('#batchName').focus();
      return;
    }

    const expenses = getExpensesFromForm();
    const totalCost = expenses.reduce((sum, e) => sum + e.amount, 0);
    const sellingPrice = parseFloat($('#sellingPrice').value) || 0;
    const profitLoss = sellingPrice - totalCost;
    const profitPct = totalCost > 0 ? ((profitLoss / totalCost) * 100) : 0;

    const batchData = {
      name,
      date,
      expenses,
      totalCost,
      sellingPrice,
      profitLoss,
      profitPct,
      updatedAt: Date.now()
    };

    if (hasFirestore && batchesRef) {
      try {
        if (editingBatchId) {
          batchesRef.doc(editingBatchId).update(batchData).catch((err) => {
            console.error('Update error:', err);
          });
          showToast('Batch updated! ☁️');
        } else {
          batchData.createdAt = Date.now();
          batchesRef.add(batchData).catch((err) => {
            console.error('Save error:', err);
          });
          showToast('Batch saved! ☁️');
        }
      } catch (err) {
        console.error('Save error:', err);
        showToast('Error — please try again');
        return;
      }
    } else {
      // Fallback: save to localStorage
      if (editingBatchId) {
        const idx = batches.findIndex((b) => b.id === editingBatchId);
        if (idx !== -1) batches[idx] = { id: editingBatchId, ...batchData };
      } else {
        batchData.createdAt = Date.now();
        batchData.id = 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        batches.push(batchData);
      }
      saveLocalBackup();
      renderDashboard();
      showToast(editingBatchId ? 'Batch updated!' : 'Batch saved!');
    }

    // Navigate immediately — Firestore offline cache + onSnapshot handles the rest
    editingBatchId = null;
    showScreen('dashboard');
  }

  // ── Delete Batch (Firestore) ──
  function deleteBatch(id) {
    if (!id) return;
    if (hasFirestore && batchesRef) {
      batchesRef.doc(id).delete().catch((err) => {
        console.error('Delete error:', err);
      });
      showToast('Batch deleted ☁️');
    } else {
      batches = batches.filter((b) => b.id !== id);
      saveLocalBackup();
      showToast('Batch deleted');
    }
    editingBatchId = null;
  }

  // ── Render Dashboard ──
  function renderDashboard() {
    const total = batches.length;
    const totalSpend = batches.reduce((s, b) => s + (b.totalCost || 0), 0);
    const totalRevenue = batches.reduce((s, b) => s + (b.sellingPrice || 0), 0);
    const completedBatches = batches.filter((b) => b.sellingPrice > 0);
    const avgProfit = completedBatches.length > 0
      ? completedBatches.reduce((s, b) => s + b.profitPct, 0) / completedBatches.length
      : 0;

    $('#totalBatches').textContent = total;
    $('#totalSpend').innerHTML = `<span class="rupee">₹</span>${formatNum(totalSpend)}`;
    $('#avgProfit').textContent = avgProfit.toFixed(1) + '%';
    $('#avgProfit').style.color = avgProfit >= 0 ? 'var(--green)' : 'var(--red)';
    $('#totalRevenue').innerHTML = `<span class="rupee">₹</span>${formatNum(totalRevenue)}`;

    // Recent batches (last 5)
    const recent = [...batches].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    renderBatchList($('#recentBatchList'), recent, true);

    // Keep local backup
    saveLocalBackup();
  }

  // ── Render History ──
  function renderHistory() {
    const query = $('#searchInput').value.toLowerCase().trim();
    let filtered = batches;

    if (query) {
      filtered = batches.filter((b) =>
        b.name.toLowerCase().includes(query) || (b.date && b.date.includes(query))
      );
    }

    filtered = [...filtered].sort((a, b) => {
      switch (currentSort) {
        case 'date-desc': return (b.createdAt || 0) - (a.createdAt || 0);
        case 'date-asc': return (a.createdAt || 0) - (b.createdAt || 0);
        case 'profit-desc': return (b.profitPct || 0) - (a.profitPct || 0);
        case 'profit-asc': return (a.profitPct || 0) - (b.profitPct || 0);
        case 'cost-desc': return (b.totalCost || 0) - (a.totalCost || 0);
        default: return (b.createdAt || 0) - (a.createdAt || 0);
      }
    });

    renderBatchList($('#historyBatchList'), filtered, false);
  }

  // ── Render Batch List ──
  function renderBatchList(container, list, showEmpty) {
    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No batches ${showEmpty ? 'yet' : 'found'}</div>
          <div class="empty-text">${showEmpty ? 'Tap the + button to create your first batch' : 'Try a different search'}</div>
        </div>`;
      return;
    }

    container.innerHTML = list.map((b) => {
      const status = b.sellingPrice > 0 ? (b.profitLoss >= 0 ? 'profit' : 'loss') : 'pending';
      const badgeText = b.sellingPrice > 0
        ? `${b.profitLoss >= 0 ? '+' : ''}${b.profitPct.toFixed(1)}%`
        : 'Pending';

      return `
        <div class="batch-card ${status}" data-id="${b.id}">
          <div class="batch-card-header">
            <div>
              <div class="batch-name">${escapeHtml(b.name)}</div>
              <div class="batch-date">${formatDate(b.date)}</div>
            </div>
            <span class="batch-profit-badge ${status}">${badgeText}</span>
          </div>
          <div class="batch-card-footer">
            <span class="batch-total">Cost: <span>₹${formatNum(b.totalCost)}</span></span>
            ${b.sellingPrice > 0 ? `<span class="batch-total">Sold: <span>₹${formatNum(b.sellingPrice)}</span></span>` : ''}
            <span class="batch-arrow">›</span>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.batch-card').forEach((card) => {
      card.addEventListener('click', () => {
        openDetail(card.dataset.id);
      });
    });
  }

  // ── Open Detail View ──
  function openDetail(id) {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    editingBatchId = id;

    $('#detailName').textContent = batch.name;
    $('#detailDate').textContent = formatDate(batch.date);

    const pctEl = $('#detailProfitPct');
    if (batch.sellingPrice > 0) {
      pctEl.textContent = (batch.profitLoss >= 0 ? '+' : '') + batch.profitPct.toFixed(1) + '%';
      pctEl.style.color = batch.profitLoss >= 0 ? 'var(--green)' : 'var(--red)';
      $('#detailProfitSummary').style.borderColor =
        batch.profitLoss >= 0 ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)';
    } else {
      pctEl.textContent = 'Pending';
      pctEl.style.color = 'var(--text-muted)';
      $('#detailProfitSummary').style.borderColor = 'var(--border)';
    }

    const expContainer = $('#detailExpenseRows');
    expContainer.innerHTML = (batch.expenses || [])
      .filter((e) => e.amount > 0)
      .map((e) => `
        <div class="detail-row">
          <span class="detail-row-label">${escapeHtml(e.name)}</span>
          <span class="detail-row-value">₹${formatNum(e.amount)}</span>
        </div>
      `).join('');

    $('#detailTotalCost').textContent = '₹' + formatNum(batch.totalCost || 0);
    $('#detailSellingPrice').textContent = batch.sellingPrice > 0 ? '₹' + formatNum(batch.sellingPrice) : '—';

    const plEl = $('#detailProfitLoss');
    if (batch.sellingPrice > 0) {
      plEl.textContent = (batch.profitLoss >= 0 ? '+₹' : '-₹') + formatNum(Math.abs(batch.profitLoss));
      plEl.style.color = batch.profitLoss >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      plEl.textContent = '—';
      plEl.style.color = 'var(--text-muted)';
    }

    const pctRowEl = $('#detailProfitPctRow');
    if (batch.sellingPrice > 0) {
      pctRowEl.textContent = batch.profitPct.toFixed(1) + '%';
      pctRowEl.style.color = batch.profitLoss >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      pctRowEl.textContent = '—';
      pctRowEl.style.color = 'var(--text-muted)';
    }

    showScreen('detail');
  }

  // ── Export Data ──
  function exportData() {
    if (batches.length === 0) {
      showToast('No data to export');
      return;
    }

    let csv = 'Batch Name,Date,';
    const allCategories = new Set();
    batches.forEach((b) => (b.expenses || []).forEach((e) => allCategories.add(e.name)));
    const cats = [...allCategories];
    csv += cats.join(',') + ',Total Cost,Selling Price,Profit/Loss,Profit %\n';

    batches.forEach((b) => {
      csv += `"${b.name}",${b.date},`;
      cats.forEach((cat) => {
        const exp = (b.expenses || []).find((e) => e.name === cat);
        csv += (exp ? exp.amount : 0) + ',';
      });
      csv += `${b.totalCost},${b.sellingPrice},${b.profitLoss},${b.profitPct.toFixed(1)}%\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-record-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported as CSV');
  }

  // ── Helpers ──
  function setTodayDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    $('#batchDate').value = `${yyyy}-${mm}-${dd}`;
  }

  function formatNum(n) {
    if (!n || n === 0) return '0';
    return n.toLocaleString('en-IN');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function showToast(msg) {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ── Start ──
  document.addEventListener('DOMContentLoaded', init);
})();
