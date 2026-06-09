const state = {
  query: '',
  page: 1,
  sort: 'popular',
  shop: '',
  totalPages: 1,
};

const PAGE_SIZE = 48;
const homeFeed = { page: 1, loading: false, done: false, total: 0, shown: 0 };
let scrollObserver = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') || '',
    page: parseInt(p.get('page'), 10) || 1,
    sort: p.get('sort') || 'popular',
    shop: p.get('shop') || '',
  };
}

function setUrl(params) {
  const p = new URLSearchParams();
  if (params.q) p.set('q', params.q);
  if (params.page > 1) p.set('page', params.page);
  if (params.sort && params.sort !== 'popular') p.set('sort', params.sort);
  if (params.shop) p.set('shop', params.shop);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : '/');
}

function placeholderImg(name) {
  const clean = String(name || 'S').replace(/^[\[\(【「『]+/, '').trim();
  const letter = (clean[0] || 'S').toUpperCase();
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#eee" width="200" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#b22204" font-size="48" font-family="sans-serif">${letter}</text></svg>`
  )}`;
}

function productImageUrl(p) {
  if (p.imageUrl) return p.imageUrl;
  if (p.productId) return `/api/product-image/${encodeURIComponent(p.productId)}`;
  return placeholderImg(p.name);
}

function renderPromoTags(p) {
  if (!p.promoTags?.length) return '';
  return `<div class="promo-tags">${p.promoTags
    .map((t) => `<span class="promo-tag promo-tag--${escapeHtml(t.type)}">${escapeHtml(t.text)}</span>`)
    .join('')}</div>`;
}

function renderPriceBlock(p) {
  if (p.hasPromo && p.originalFormatted) {
    return `
      <div class="price-block price-block--deal">
        <div class="price-row">
          <span class="product-price">${escapeHtml(p.priceFormatted)}</span>
          <span class="promo-badge">-${p.discountPercent}%</span>
        </div>
        <div class="price-original">Giá gốc: ${escapeHtml(p.originalFormatted)}</div>
        <div class="price-save-box">
          <span class="material-symbols-outlined" style="font-size:16px">savings</span>
          Rẻ hơn ${escapeHtml(p.savingsFormatted)}
        </div>
      </div>`;
  }
  return `
    <div class="price-block">
      <div class="product-price">${escapeHtml(p.priceFormatted || 'Liên hệ')}</div>
    </div>`;
}

function renderProductCard(p) {
  const img = productImageUrl(p);
  const fallback = placeholderImg(p.name);
  const cornerBadge = p.hasPromo
    ? `<span class="badge badge-promo">-${p.discountPercent}%</span>`
    : p.isHot
      ? `<span class="badge badge-hot">HOT</span>`
      : '';
  return `
    <a class="product-card${p.hasPromo ? ' product-card--deal' : ''}" href="${p.affiliateLink}" target="_blank" rel="noopener noreferrer">
      <div class="product-img">
        <img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async" onerror="this.onerror=null;this.src='${fallback}'"/>
        ${cornerBadge}
      </div>
      <div class="product-body">
        ${renderPromoTags(p)}
        <h3 class="line-clamp-2">${escapeHtml(p.name)}</h3>
        ${renderPriceBlock(p)}
        ${p.promoHighlight ? `<div class="promo-highlight">${escapeHtml(p.promoHighlight)}</div>` : ''}
        <div class="product-meta">
          ${p.shopName ? escapeHtml(p.shopName) : ''}
          ${p.soldLabel ? ` · ${escapeHtml(p.soldLabel)}` : ''}
        </div>
        <div class="buy-cta">${escapeHtml(p.buyerCta || 'Mua ngay')}</div>
      </div>
    </a>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function fetchSearch() {
  const params = new URLSearchParams({
    q: state.query,
    page: state.page,
    sort: state.sort,
    limit: PAGE_SIZE,
  });
  if (state.shop) params.set('shop', state.shop);

  const res = await fetch(`/api/search?${params}`);
  return res.json();
}

async function loadResults() {
  const grid = $('#productGrid');
  grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:32px">Đang tải...</p>';

  try {
    const data = await fetchSearch();
    state.totalPages = data.totalPages;

    $('#resultMeta').textContent = state.query
      ? `"${state.query}" — ${data.total.toLocaleString('vi-VN')} sản phẩm`
      : `${data.total.toLocaleString('vi-VN')} sản phẩm`;

    if (data.items.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <span class="material-symbols-outlined">search_off</span>
          <p>Không tìm thấy sản phẩm nào</p>
        </div>`;
    } else {
      grid.innerHTML = data.items.map(renderProductCard).join('');
    }

    renderPagination();
  } catch {
    grid.innerHTML = '<p style="grid-column:1/-1;color:#ba1a1a">Lỗi tải dữ liệu</p>';
  }
}

function renderPagination() {
  const el = $('#pagination');
  if (state.totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `<button class="page-btn" ${state.page <= 1 ? 'disabled' : ''} data-page="${state.page - 1}">‹</button>`;
  const start = Math.max(1, state.page - 2);
  const end = Math.min(state.totalPages, state.page + 2);
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  html += `<button class="page-btn" ${state.page >= state.totalPages ? 'disabled' : ''} data-page="${state.page + 1}">›</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.page-btn:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page, 10);
      setUrl(state);
      loadResults();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function doSearch(q) {
  state.query = q.trim();
  state.page = 1;
  setUrl(state);

  if (state.query) {
    $('#heroSection').style.display = 'none';
    $('#featuredSection').style.display = 'none';
    $('#resultsSection').style.display = 'block';
    $('#navSearchInput').value = state.query;
    loadResults();
  } else {
    showHome();
  }
}

function showHome() {
  $('#heroSection').style.display = '';
  $('#featuredSection').style.display = '';
  $('#resultsSection').style.display = 'none';
  resetHomeFeed();
  loadFeatured(false);
  setupInfiniteScroll();
}

function resetHomeFeed() {
  homeFeed.page = 1;
  homeFeed.loading = false;
  homeFeed.done = false;
  homeFeed.total = 0;
  homeFeed.shown = 0;
}

function updateHomeFeedMeta() {
  const countEl = $('#homeFeedCount');
  const hintEl = $('#loadMoreHint');
  if (countEl) {
    countEl.textContent = homeFeed.total
      ? `Đang hiển thị ${homeFeed.shown.toLocaleString('vi-VN')} / ${homeFeed.total.toLocaleString('vi-VN')}`
      : '';
  }
  if (hintEl) {
    hintEl.textContent = homeFeed.done
      ? 'Đã hiển thị tất cả sản phẩm'
      : 'Cuộn xuống hoặc bấm Tải thêm';
  }
  const wrap = $('#loadMoreWrap');
  const btn = $('#loadMoreBtn');
  if (wrap && btn) {
    wrap.style.display = homeFeed.done ? 'none' : '';
    btn.disabled = homeFeed.loading;
    btn.textContent = homeFeed.loading ? 'Đang tải...' : 'Tải thêm sản phẩm';
  }
}

async function loadFeatured(append = false) {
  if (homeFeed.loading || homeFeed.done) return;
  homeFeed.loading = true;
  updateHomeFeedMeta();

  const grid = $('#featuredGrid');
  if (!append) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:32px">Đang tải...</p>';

  try {
    const res = await fetch(`/api/search?limit=${PAGE_SIZE}&page=${homeFeed.page}&sort=deal`);
    if (!res.ok) throw new Error(`API lỗi ${res.status}`);
    const data = await res.json();
    if (!data.items) throw new Error('Dữ liệu không hợp lệ');
    homeFeed.total = data.total;

    if (!append) grid.innerHTML = '';
    if (data.items.length === 0 && !append) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:32px">Chưa có sản phẩm</p>';
      homeFeed.done = true;
    } else {
      grid.insertAdjacentHTML('beforeend', data.items.map(renderProductCard).join(''));
      homeFeed.shown += data.items.length;
      if (homeFeed.page >= data.totalPages || data.items.length === 0) homeFeed.done = true;
      else homeFeed.page += 1;
    }
  } catch (err) {
    if (!append) {
      grid.innerHTML = `<p style="grid-column:1/-1;color:#ba1a1a;text-align:center;padding:32px">Lỗi tải sản phẩm — ${escapeHtml(err.message || 'thử F5')}</p>`;
    }
    homeFeed.done = true;
  }

  homeFeed.loading = false;
  updateHomeFeedMeta();
}

function setupInfiniteScroll() {
  if (scrollObserver) scrollObserver.disconnect();
  const sentinel = $('#scrollSentinel');
  if (!sentinel) return;
  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !homeFeed.done && !homeFeed.loading) {
        loadFeatured(true);
      }
    },
    { rootMargin: '400px' }
  );
  scrollObserver.observe(sentinel);
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  $('#statsBar').innerHTML = `
    <strong>${data.totalProducts.toLocaleString('vi-VN')}</strong> sản phẩm deal
    · <strong>${data.totalShops.toLocaleString('vi-VN')}</strong> shop
  `;
}

async function loadTrending() {
  const res = await fetch('/api/trending');
  const data = await res.json();
  const container = $('#trendingTags');
  container.innerHTML = '<span>Xu hướng:</span>';
  data.items.slice(0, 6).forEach((name) => {
    const words = name.split(' ').slice(0, 3).join(' ');
    const btn = document.createElement('button');
    btn.className = 'trend-chip';
    btn.textContent = words.length > 20 ? words.slice(0, 20) + '…' : words;
    btn.addEventListener('click', () => doSearch(words));
    container.appendChild(btn);
  });
}

async function loadShops() {
  const res = await fetch('/api/shops');
  const data = await res.json();
  const sel = $('#shopFilter');
  data.items.forEach(({ shop_name }) => {
    const opt = document.createElement('option');
    opt.value = shop_name;
    opt.textContent = shop_name;
    if (shop_name === state.shop) opt.selected = true;
    sel.appendChild(opt);
  });
}

function initSort() {
  $$('.sort-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sort === state.sort);
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      state.page = 1;
      $$('.sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $('#sortFilter').value = state.sort;
      setUrl(state);
      loadResults();
    });
  });

  $('#sortFilter')?.addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.page = 1;
    $$('.sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.sort === state.sort));
    setUrl(state);
    loadResults();
  });

  $('#shopFilter')?.addEventListener('change', (e) => {
    state.shop = e.target.value;
    state.page = 1;
    setUrl(state);
    loadResults();
  });
}

function initForms() {
  const handleSubmit = (e, input) => {
    e.preventDefault();
    doSearch(input.value);
  };
  $('#heroSearchForm')?.addEventListener('submit', (e) => handleSubmit(e, $('#heroSearchInput')));
  $('#navSearchForm')?.addEventListener('submit', (e) => handleSubmit(e, $('#navSearchInput')));
  $('#loadMoreBtn')?.addEventListener('click', () => loadFeatured(true));
}

function init() {
  const params = getParams();
  state.query = params.q;
  state.page = params.page;
  state.sort = params.sort;
  state.shop = params.shop;

  initForms();
  initSort();
  loadStats();
  loadTrending();
  loadShops();

  if (state.query) {
    $('#navSearchInput').value = state.query;
    doSearch(state.query);
  } else {
    showHome();
  }
}

document.addEventListener('DOMContentLoaded', init);
