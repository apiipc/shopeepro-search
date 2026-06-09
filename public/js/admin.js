const TOKEN_KEY = 'shopeepro_admin_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let page = 1;
let searchQ = '';
let debounceTimer;

const $ = (s) => document.querySelector(s);

let toastHideTimer;

function toast(msg, opts = {}) {
  const { type = '', duration = type === 'error' ? 7000 : 4500 } = opts;
  const el = $('#toast');
  clearTimeout(toastHideTimer);
  el.textContent = msg;
  el.className = 'toast show' + (type ? ` ${type}` : '');
  if (duration > 0) {
    toastHideTimer = setTimeout(() => el.classList.remove('show'), duration);
  }
}

function setImportLoading(on, text) {
  const label = $('#csvImportLabel');
  const labelText = $('#csvImportLabelText');
  const status = $('#importStatus');
  const statusText = $('#importStatusText');
  if (on) {
    label.classList.add('is-loading');
    labelText.textContent = 'Đang import…';
    status.classList.remove('hidden');
    statusText.textContent = text || 'Đang import CSV…';
  } else {
    label.classList.remove('is-loading');
    labelText.textContent = 'Import CSV';
    status.classList.add('hidden');
  }
}

function headers() {
  return { 'Content-Type': 'application/json', 'X-Admin-Token': token };
}

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...headers(), ...opts.headers } });
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lỗi');
  return data;
}

function showPanel() {
  $('#loginBox').style.display = 'none';
  $('#adminPanel').style.display = 'block';
  loadProducts();
}

function logout() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  $('#loginBox').style.display = 'block';
  $('#adminPanel').style.display = 'none';
}

async function login() {
  const password = $('#loginPassword').value;
  try {
    const data = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((r) => r.json());

    if (data.ok) {
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      showPanel();
      toast('Đăng nhập thành công');
    } else {
      toast('Sai mật khẩu');
    }
  } catch {
    toast('Sai mật khẩu');
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

async function loadProducts() {
  const params = new URLSearchParams({ page, limit: 20 });
  if (searchQ) params.set('q', searchQ);

  try {
    const data = await api(`/api/admin/products?${params}`);
    $('#adminStats').textContent = `${data.total.toLocaleString('vi-VN')} sản phẩm trong hệ thống`;

    const tbody = $('#adminTableBody');
    if (data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px">Chưa có sản phẩm</td></tr>';
    } else {
      tbody.innerHTML = data.items.map((p) => `
        <tr>
          <td>${p.id}</td>
          <td style="max-width:220px">${escapeHtml(p.name.slice(0, 60))}${p.name.length > 60 ? '…' : ''}</td>
          <td>${escapeHtml(p.price)}</td>
          <td>${escapeHtml(p.shopName)}</td>
          <td>${escapeHtml(p.commissionRate)}</td>
          <td><a href="${escapeHtml(p.affiliateLink)}" target="_blank" style="color:#b22204;font-size:12px">s.shopee.vn</a></td>
          <td>${p.active ? '✅' : '⛔'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-secondary btn-sm edit-btn" data-id="${p.id}">Sửa</button>
            <button class="btn btn-danger btn-sm del-btn" data-id="${p.id}">Xóa</button>
          </td>
        </tr>`).join('');
    }

    tbody.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => openEdit(parseInt(btn.dataset.id, 10), data.items));
    });
    tbody.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteProduct(parseInt(btn.dataset.id, 10)));
    });

    renderAdminPagination(data.totalPages);
  } catch (err) {
    toast(err.message);
  }
}

function renderAdminPagination(totalPages) {
  const el = $('#adminPagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= Math.min(totalPages, 10); i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach((btn) => {
    btn.addEventListener('click', () => { page = parseInt(btn.dataset.p, 10); loadProducts(); });
  });
}

function openEdit(id, items) {
  const p = items?.find((x) => x.id === id) || {};
  $('#modalTitle').textContent = id ? 'Sửa sản phẩm' : 'Thêm sản phẩm';
  $('#editId').value = id || '';
  $('#fProductId').value = p.productId || '';
  $('#fName').value = p.name || '';
  $('#fPrice').value = p.price || '';
  $('#fOriginalPrice').value = p.originalPrice || '';
  $('#fPromoLabel').value = p.promoLabel || '';
  $('#fShopName').value = p.shopName || '';
  $('#fCommissionRate').value = p.commissionRate || '';
  $('#fCommission').value = p.commission || '';
  $('#fRevenue').value = p.revenue || '';
  $('#fProductLink').value = p.productLink || '';
  $('#fAffiliateLink').value = p.affiliateLink || '';
  $('#fImageUrl').value = p.imageUrl || '';
  $('#fActive').checked = p.active !== false;
  $('#editModal').classList.add('open');
}

function closeModal() {
  $('#editModal').classList.remove('open');
  $('#productForm').reset();
  $('#editId').value = '';
}

async function saveProduct(e) {
  e.preventDefault();
  const id = $('#editId').value;
  const body = {
    productId: $('#fProductId').value,
    name: $('#fName').value,
    price: $('#fPrice').value,
    originalPrice: $('#fOriginalPrice').value,
    promoLabel: $('#fPromoLabel').value,
    shopName: $('#fShopName').value,
    commissionRate: $('#fCommissionRate').value,
    commission: $('#fCommission').value,
    revenue: $('#fRevenue').value,
    productLink: $('#fProductLink').value,
    affiliateLink: $('#fAffiliateLink').value,
    imageUrl: $('#fImageUrl').value,
    active: $('#fActive').checked,
  };

  try {
    if (id) {
      await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Đã cập nhật');
    } else {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      toast('Đã thêm sản phẩm');
    }
    closeModal();
    loadProducts();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('Xóa sản phẩm này?')) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    toast('Đã xóa');
    loadProducts();
  } catch (err) {
    toast(err.message);
  }
}

async function uploadCsv(file) {
  const name = file.name;
  const sizeKb = Math.max(1, Math.round(file.size / 1024));
  setImportLoading(true, `Đang import «${name}» (${sizeKb} KB) — file lớn có thể mất 1–2 phút…`);
  toast(`Đang import ${name}…`, { type: 'info', duration: 0 });

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 300000);

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/admin/import-csv', {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
      body: fd,
      signal: controller.signal,
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      throw new Error('Phản hồi server không hợp lệ — thử lại hoặc chia file nhỏ hơn');
    }

    if (!res.ok) throw new Error(data.error || `Lỗi server (${res.status})`);

    const parts = [];
    if (data.created) parts.push(`${data.created} mới`);
    if (data.updated) parts.push(`${data.updated} cập nhật`);
    if (data.duplicatesInFile) parts.push(`${data.duplicatesInFile} trùng đã gộp`);
    if (data.skipped) parts.push(`${data.skipped} bỏ qua`);

    const total = data.processed ?? data.imported ?? data.totalRows;
    const summary = parts.length ? parts.join(', ') : 'không có dòng hợp lệ';
    const msg = parts.length
      ? `Import xong: ${summary}${total != null ? ` · ${total} dòng xử lý` : ''}`
      : 'Import xong nhưng không có dòng hợp lệ — kiểm tra cột Link ưu đãi trong CSV';

    toast(msg, { type: parts.length ? 'success' : 'error' });
    setImportLoading(false);
    await loadProducts();
  } catch (err) {
    const msg =
      err.name === 'AbortError'
        ? 'Import quá lâu (>5 phút) — thử chia CSV thành nhiều file nhỏ hơn'
        : err.message || 'Import thất bại';
    toast(msg, { type: 'error' });
    setImportLoading(false);
    throw err;
  } finally {
    clearTimeout(abortTimer);
  }
}

async function syncNoxBatch(offset = 0) {
  const data = await api('/api/admin/sync-noxapi', {
    method: 'POST',
    body: JSON.stringify({ limit: 10, offset }),
  });
  return data;
}

async function syncNoxAll() {
  if (!confirm('Sync giá/ảnh từ Shopee qua NoxAPI? (10 SP/lượt, tốn credit API)')) return;
  let offset = 0;
  let totalUpdated = 0;
  $('#syncNoxBtn').disabled = true;
  try {
    for (;;) {
      toast(`Đang sync... offset ${offset}`);
      const data = await syncNoxBatch(offset);
      totalUpdated += data.updated;
      if (data.done || data.processed === 0) break;
      offset = data.nextOffset;
    }
    toast(`NoxAPI: đã cập nhật ${totalUpdated} sản phẩm`);
    loadProducts();
  } catch (err) {
    toast(err.message);
  } finally {
    $('#syncNoxBtn').disabled = false;
  }
}

function init() {
  $('#loginBtn').addEventListener('click', login);
  $('#loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logoutBtn').addEventListener('click', logout);
  $('#addProductBtn').addEventListener('click', () => openEdit(null, []));
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#productForm').addEventListener('submit', saveProduct);
  $('#editModal').addEventListener('click', (e) => { if (e.target.id === 'editModal') closeModal(); });

  $('#adminSearch').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQ = e.target.value;
      page = 1;
      loadProducts();
    }, 400);
  });

  $('#csvUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await uploadCsv(file);
    } catch {
      /* uploadCsv đã hiện toast lỗi */
    }
    e.target.value = '';
  });

  $('#syncNoxBtn')?.addEventListener('click', syncNoxAll);

  if (token) showPanel();
}

document.addEventListener('DOMContentLoaded', init);
