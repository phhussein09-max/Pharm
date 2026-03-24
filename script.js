// ---------- IndexedDB Setup ----------
const db = new Dexie('PharmacyDB');
db.version(1).stores({
    meds: '++id, name, expiry, type, category, company',
    deletedMeds: '++id, name, expiry',
    users: '++id, email, password, name, image',
    notifications: '++id, message, date, read'
});

// Global state
let currentUser = null;
let currentView = 'all';
let searchQuery = '';
let sortBy = 'expiry_asc';
let typeFilter = 'all';
let companyFilter = '';
let selectedMeds = new Set(); // for batch delete
let chart = null;
let currentMed = null;

// Load demo data if empty
async function initDemoData() {
    const count = await db.meds.count();
    if (count === 0) {
        const demo = [
            { name: "GENTAGUT EYE/ EAR 0.3% DROP", scientificName: "Gentamicin sulfate 5 mg/ml", company: "Billim", origin: "Turkey", type: "pharmacy", category: "مضادات حيوية", expiry: "2026-12-31", image: null },
            { name: "Paracetamol Expiring 2 days", scientificName: "Paracetamol 500mg", company: "DemoPharma", origin: "Iraq", type: "pharmacy", category: "مسكنات وخافضات حرارة", expiry: new Date(Date.now() + 2*86400000).toISOString().split('T')[0], image: null },
            { name: "Ibuprofen Expiring 5 days", scientificName: "Ibuprofen 400mg", company: "DemoPharma", origin: "Iraq", type: "pharmacy", category: "مسكنات وخافضات حرارة", expiry: new Date(Date.now() + 5*86400000).toISOString().split('T')[0], image: null },
            { name: "Amoxicillin Expiring 7 days", scientificName: "Amoxicillin 500mg", company: "DemoPharma", origin: "Iraq", type: "pharmacy", category: "مضادات حيوية", expiry: new Date(Date.now() + 7*86400000).toISOString().split('T')[0], image: null }
        ];
        await db.meds.bulkAdd(demo);
    }
    const userCount = await db.users.count();
    if (userCount === 0) {
        const hashed = bcrypt.hashSync("123456", 10);
        await db.users.add({ email: "admin@example.com", password: hashed, name: "Admin", image: null });
    }
}

// Auth functions
async function login(email, password) {
    const user = await db.users.where('email').equals(email).first();
    if (user && bcrypt.compareSync(password, user.password)) {
        currentUser = user;
        localStorage.setItem('currentUserId', user.id);
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('appSection').style.display = 'block';
        loadUserProfile();
        refreshCurrentView();
        checkExpiryNotifications();
        return true;
    }
    return false;
}

async function register(email, password, name) {
    const existing = await db.users.where('email').equals(email).first();
    if (existing) return false;
    const hashed = bcrypt.hashSync(password, 10);
    const id = await db.users.add({ email, password: hashed, name, image: null });
    currentUser = { id, email, name, image: null };
    localStorage.setItem('currentUserId', id);
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('appSection').style.display = 'block';
    loadUserProfile();
    refreshCurrentView();
    return true;
}

function loadUserProfile() {
    if (currentUser) {
        document.getElementById('profileName').innerText = currentUser.name || currentUser.email;
        const img = document.getElementById('profileImg');
        if (currentUser.image) img.src = currentUser.image;
        else img.src = '';
    }
}

async function logout() {
    currentUser = null;
    localStorage.removeItem('currentUserId');
    document.getElementById('loginSection').style.display = 'flex';
    document.getElementById('appSection').style.display = 'none';
    selectedMeds.clear();
}

// Helper functions
function getDaysRemaining(expiryDateStr) {
    const today = new Date(); today.setHours(0,0,0,0);
    const expiry = new Date(expiryDateStr); expiry.setHours(0,0,0,0);
    return Math.ceil((expiry - today) / (1000*60*60*24));
}

async function getFilteredAndSorted() {
    let list = await db.meds.toArray();
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(m => m.name.toLowerCase().includes(q) || (m.scientificName && m.scientificName.toLowerCase().includes(q)));
    }
    if (typeFilter !== 'all') list = list.filter(m => m.type === typeFilter);
    if (companyFilter.trim()) list = list.filter(m => m.company && m.company.toLowerCase().includes(companyFilter.toLowerCase()));
    if (sortBy === 'expiry_asc') list.sort((a,b) => getDaysRemaining(a.expiry) - getDaysRemaining(b.expiry));
    else if (sortBy === 'expiry_desc') list.sort((a,b) => getDaysRemaining(b.expiry) - getDaysRemaining(a.expiry));
    else if (sortBy === 'name_asc') list.sort((a,b) => a.name.localeCompare(b.name));
    else if (sortBy === 'name_desc') list.sort((a,b) => b.name.localeCompare(a.name));
    return list;
}

async function refreshCurrentView() {
    const container = document.getElementById('dynamicContent');
    if (!container) return;
    if (currentView === 'all') {
        container.innerHTML = renderSearchAndFilters();
        const list = await getFilteredAndSorted();
        renderMedications(list);
        document.getElementById('chartContainer').style.display = 'block';
        updateChart();
    } else if (currentView === 'pharmacy') {
        container.innerHTML = renderSearchAndFilters();
        const list = await getFilteredAndSorted();
        renderMedications(list.filter(m => m.type === 'pharmacy'));
        document.getElementById('chartContainer').style.display = 'none';
    } else if (currentView === 'categories') {
        container.innerHTML = `<div id="contentList"></div>`;
        renderCategories();
        document.getElementById('chartContainer').style.display = 'none';
    } else if (currentView === 'companies') {
        container.innerHTML = `<div id="contentList"></div>`;
        renderCompanies();
        document.getElementById('chartContainer').style.display = 'none';
    } else if (currentView === 'expiring') {
        container.innerHTML = renderSearchAndFilters();
        const list = await db.meds.toArray();
        const soon = list.filter(m => { const d = getDaysRemaining(m.expiry); return d >= 0 && d <= 7; });
        renderMedications(soon);
        document.getElementById('chartContainer').style.display = 'none';
    } else if (currentView === 'add') {
        showAddForm();
        document.getElementById('chartContainer').style.display = 'none';
    }
    showStats();
    document.getElementById('pageTitle').innerText = getPageTitle();
}

function renderSearchAndFilters() {
    return `
        <div class="search-bar"><input type="text" id="search" placeholder="🔍 بحث..." oninput="searchMed(event)"></div>
        <div class="filters-bar">
            <select id="sortBy" onchange="applyFiltersAndSort()">
                <option value="expiry_asc">📅 الأقرب انتهاء أولاً</option>
                <option value="expiry_desc">📅 الأبعد انتهاء أولاً</option>
                <option value="name_asc">🔤 اسم (أ-ي)</option>
                <option value="name_desc">🔤 اسم (ي-أ)</option>
            </select>
            <select id="typeFilter" onchange="applyFiltersAndSort()">
                <option value="all">🏷️ الكل</option>
                <option value="pharmacy">🏥 صيدلية</option>
                <option value="home">🏠 منزل</option>
            </select>
            <input type="text" id="companyFilter" placeholder="🏭 اسم الشركة" oninput="applyFiltersAndSort()">
            <button class="batch-delete-btn" onclick="batchDelete()">🗑️ حذف المحدد</button>
        </div>
        <div class="content-list" id="contentList"></div>
    `;
}

function renderMedications(list) {
    const container = document.getElementById('contentList');
    if (!container) return;
    container.innerHTML = '';
    if (!list.length) { container.innerHTML = '<div class="empty-state">✨ لا توجد أدوية</div>'; return; }
    list.forEach(med => {
        const days = getDaysRemaining(med.expiry);
        const statusClass = days < 0 ? 'expired' : (days <= 30 ? 'warning' : '');
        const expiryFormatted = med.expiry.split('-').reverse().join('/');
        const thumb = med.image ? `<img src="${med.image}" class="med-image-thumb">` : '<div class="med-image-thumb">💊</div>';
        const checked = selectedMeds.has(med.id) ? 'checked' : '';
        const card = document.createElement('div');
        card.className = `med-card ${statusClass} ${selectedMeds.has(med.id) ? 'selected' : ''}`;
        card.innerHTML = `
            <div class="med-info">
                <input type="checkbox" class="med-select" data-id="${med.id}" ${checked} onclick="event.stopPropagation(); toggleSelectMed(${med.id})">
                ${thumb}
                <div class="med-text">
                    <div class="med-name">💊 ${escapeHtml(med.name)}</div>
                    <div class="med-details">
                        <span>📅 ${expiryFormatted}</span>
                        <span>⏳ ${days<0?'🔴 منتهي':(days<=7?`🟠 متبقي ${days} يوم`:`✅ متبقي ${days} يوم`)}</span>
                        <span>${med.type === 'pharmacy' ? '🏥 صيدلية' : '🏠 منزل'}</span>
                        ${med.scientificName ? `<span>🔬 ${escapeHtml(med.scientificName)}</span>` : ''}
                        ${med.company ? `<span>🏭 ${escapeHtml(med.company)}</span>` : ''}
                    </div>
                </div>
            </div>
            <button class="delete-btn" data-id="${med.id}" onclick="event.stopPropagation(); deleteSingleMed(${med.id})">🗑️</button>
        `;
        card.addEventListener('click', () => showMedDetails(med));
        container.appendChild(card);
    });
}

function toggleSelectMed(id) {
    if (selectedMeds.has(id)) selectedMeds.delete(id);
    else selectedMeds.add(id);
    refreshCurrentView(); // re-render to update checkboxes
}

async function deleteSingleMed(id) {
    if (confirm('هل أنت متأكد من حذف هذا الدواء؟')) {
        const med = await db.meds.get(id);
        if (med) {
            await db.deletedMeds.add(med);
            await db.meds.delete(id);
            selectedMeds.delete(id);
            refreshCurrentView();
            updateChart();
        }
    }
}

async function batchDelete() {
    if (selectedMeds.size === 0) return alert('لم يتم اختيار أي دواء');
    if (confirm(`هل تريد حذف ${selectedMeds.size} دواء؟`)) {
        for (let id of selectedMeds) {
            const med = await db.meds.get(id);
            if (med) await db.deletedMeds.add(med);
            await db.meds.delete(id);
        }
        selectedMeds.clear();
        refreshCurrentView();
        updateChart();
    }
}

async function renderCategories() {
    const container = document.getElementById('contentList');
    const medsArr = await db.meds.toArray();
    const cats = [...new Set(medsArr.map(m => m.category).filter(c => c))];
    if (!cats.length) { container.innerHTML = '<div class="empty-state">لا توجد تصنيفات</div>'; return; }
    container.innerHTML = `<div class="categories-grid">${cats.map(c => `<div class="category-card" data-category="${c}">${c}</div>`).join('')}</div>`;
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', async () => {
            const cat = card.getAttribute('data-category');
            const filtered = (await db.meds.toArray()).filter(m => m.category === cat);
            renderMedications(filtered);
        });
    });
}

async function renderCompanies() {
    const container = document.getElementById('contentList');
    const medsArr = await db.meds.toArray();
    const comps = [...new Set(medsArr.map(m => m.company).filter(c => c && c.trim()))];
    if (!comps.length) { container.innerHTML = '<div class="empty-state">لا توجد شركات</div>'; return; }
    container.innerHTML = `<div class="companies-grid">${comps.map(c => `<div class="company-card" data-company="${c}">${c}</div>`).join('')}</div>`;
    document.querySelectorAll('.company-card').forEach(card => {
        card.addEventListener('click', async () => {
            const comp = card.getAttribute('data-company');
            const filtered = (await db.meds.toArray()).filter(m => m.company === comp);
            renderMedications(filtered);
        });
    });
}

function showAddForm() {
    const container = document.getElementById('dynamicContent');
    container.innerHTML = `
        <div class="add-form">
            <input type="text" id="medName" placeholder="🌿 الاسم التجاري للدواء *">
            <input type="text" id="scientificName" placeholder="🔬 الاسم العلمي (اختياري)">
            <input type="text" id="company" placeholder="🏭 اسم الشركة">
            <input type="text" id="origin" placeholder="🌍 المنشأ">
            <select id="medType"><option value="pharmacy">🏥 صيدلية</option><option value="home">🏠 منزل</option></select>
            <select id="medCategory"><option value="">اختر التصنيف</option><option>مضادات حيوية</option><option>مسكنات وخافضات حرارة</option><option>أدوية الضغط والقلب</option><option>فيتامينات ومكملات</option><option>أدوية الجهاز الهضمي</option><option>أدوية الجهاز التنفسي</option><option>أدوية السكري</option><option>أدوية موضعية</option><option>أخرى</option></select>
            <input type="date" id="medExpiry" placeholder="📅 تاريخ الانتهاء *">
            <input type="file" id="medImage" accept="image/*">
            <button class="save-btn" id="submitAddBtn">💾 حفظ الدواء</button>
        </div>
    `;
    document.getElementById('submitAddBtn').addEventListener('click', async () => {
        const name = document.getElementById('medName').value.trim();
        const expiry = document.getElementById('medExpiry').value;
        if (!name || !expiry) { alert('الاسم وتاريخ الانتهاء مطلوبان'); return; }
        const newMed = {
            name, expiry,
            scientificName: document.getElementById('scientificName').value.trim(),
            company: document.getElementById('company').value.trim(),
            origin: document.getElementById('origin').value.trim(),
            type: document.getElementById('medType').value,
            category: document.getElementById('medCategory').value,
            image: null
        };
        const imgFile = document.getElementById('medImage').files[0];
        if (imgFile) {
            const reader = new FileReader();
            reader.onload = async (e) => { newMed.image = e.target.result; await db.meds.add(newMed); afterAdd(); };
            reader.readAsDataURL(imgFile);
        } else { await db.meds.add(newMed); afterAdd(); }
        function afterAdd() { switchView('all'); alert('تمت الإضافة'); }
    });
}

async function showStats() {
    const medsArr = await db.meds.toArray();
    const total = medsArr.length;
    const expired = medsArr.filter(m => getDaysRemaining(m.expiry) < 0).length;
    const expiring30 = medsArr.filter(m => { const d = getDaysRemaining(m.expiry); return d >= 0 && d <= 30; }).length;
    const pharmacyCount = medsArr.filter(m => m.type === 'pharmacy').length;
    document.getElementById('stats').innerHTML = `
        <div class="stats-box">
            <div>📊 إجمالي: <strong>${total}</strong></div>
            <div>🏥 صيدلية: <strong>${pharmacyCount}</strong></div>
            <div>❌ منتهية: <strong style="color:var(--danger)">${expired}</strong></div>
            <div>⚠️ تنتهي خلال 30 يوم: <strong style="color:var(--warning)">${expiring30}</strong></div>
            <div class="export-buttons"><button onclick="exportCSV()">📄 CSV</button><button onclick="exportPDF()">📑 PDF</button></div>
        </div>
    `;
}

async function updateChart() {
    const ctx = document.getElementById('expiryChart').getContext('2d');
    const medsArr = await db.meds.toArray();
    const expired = medsArr.filter(m => getDaysRemaining(m.expiry) < 0).length;
    const soon = medsArr.filter(m => { const d = getDaysRemaining(m.expiry); return d >= 0 && d <= 30; }).length;
    const later = medsArr.filter(m => getDaysRemaining(m.expiry) > 30).length;
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'pie',
        data: { labels: ['منتهية', 'تنتهي خلال 30 يوم', 'أكثر من 30 يوم'], datasets: [{ data: [expired, soon, later], backgroundColor: ['#e76f51', '#f4a261', '#2a9d8f'] }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

async function exportCSV() {
    const medsArr = await db.meds.toArray();
    const headers = ['الاسم', 'العلمي', 'الشركة', 'المنشأ', 'النوع', 'التصنيف', 'تاريخ الانتهاء'];
    const rows = medsArr.map(m => [m.name, m.scientificName || '', m.company || '', m.origin || '', m.type === 'pharmacy' ? 'صيدلية' : 'منزل', m.category || '', m.expiry]);
    let csv = headers.join(',') + '\n' + rows.map(r => r.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'pharmacy_export.csv');
}

async function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const medsArr = await db.meds.toArray();
    const tableData = medsArr.map(m => [m.name, m.scientificName || '', m.company || '', m.expiry]);
    doc.autoTable({ head: [['الاسم', 'العلمي', 'الشركة', 'تاريخ الانتهاء']], body: tableData, styles: { font: 'helvetica', halign: 'right' }, startY: 20 });
    doc.save('pharmacy_export.pdf');
}

async function checkExpiryNotifications() {
    const medsArr = await db.meds.toArray();
    const expiringSoon = medsArr.filter(m => { const d = getDaysRemaining(m.expiry); return d >= 0 && d <= 3; });
    if (expiringSoon.length && Notification.permission === 'granted') {
        expiringSoon.forEach(med => new Notification(`⚠️ دواء منتهي قريباً: ${med.name}`, { body: `ينتهي في ${med.expiry}` }));
    }
    // save to notifications DB
    for (let med of expiringSoon) {
        await db.notifications.add({ message: `${med.name} ينتهي في ${med.expiry}`, date: new Date(), read: false });
    }
    updateNotifBadge();
}

async function updateNotifBadge() {
    const count = await db.notifications.where('read').equals(false).count();
    const badge = document.getElementById('notifBadge');
    if (count > 0) { badge.innerText = count; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
}

async function showNotifications() {
    const notifs = await db.notifications.orderBy('date').reverse().toArray();
    const container = document.getElementById('notifList');
    container.innerHTML = notifs.map(n => `<div class="notif-item">${n.message} - ${new Date(n.date).toLocaleString()}</div>`).join('');
    await db.notifications.where('read').equals(false).modify({ read: true });
    updateNotifBadge();
    openModal('notifModal');
}

// Modal helpers
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
async function showMedDetails(med) { currentMed = med; document.getElementById('medDetail').innerHTML = `<div class="med-detail-item"><div class="med-detail-label">الاسم:</div><div class="med-detail-value">${escapeHtml(med.name)}</div></div><div class="med-detail-item"><div class="med-detail-label">العلمي:</div><div class="med-detail-value">${med.scientificName || '-'}</div></div><div class="med-detail-item"><div class="med-detail-label">الشركة:</div><div class="med-detail-value">${med.company || '-'}</div></div><div class="med-detail-item"><div class="med-detail-label">المنشأ:</div><div class="med-detail-value">${med.origin || '-'}</div></div><div class="med-detail-item"><div class="med-detail-label">التصنيف:</div><div class="med-detail-value">${med.category || '-'}</div></div><div class="med-detail-item"><div class="med-detail-label">تاريخ الانتهاء:</div><div class="med-detail-value">${med.expiry}</div></div>${med.image ? `<img src="${med.image}" class="med-image">` : ''}`; openModal('medModal'); }
function editCurrentMed() { closeModal('medModal'); showEditForm(currentMed); }
async function deleteCurrentMed() { await deleteSingleMed(currentMed.id); closeModal('medModal'); }
function showEditForm(med) { document.getElementById('editFormContainer').innerHTML = `<input type="text" id="editName" value="${escapeHtml(med.name)}"><input type="date" id="editExpiry" value="${med.expiry}">`; openModal('editModal'); }
async function saveEditMed() { currentMed.name = document.getElementById('editName').value; currentMed.expiry = document.getElementById('editExpiry').value; await db.meds.update(currentMed.id, currentMed); closeModal('editModal'); refreshCurrentView(); updateChart(); }

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function getPageTitle() { const titles = { all: '📦 كل الأدوية', pharmacy: '🏥 أدوية الصيدلية', categories: '📂 التصنيفات العلاجية', companies: '🏭 الشركات الدولية', expiring: '⚠️ الأدوية القريبة', add: '➕ إضافة دواء' }; return titles[currentView] || titles.all; }
function switchView(view) { currentView = view; refreshCurrentView(); }
function searchMed(e) { searchQuery = e.target.value; refreshCurrentView(); }
function applyFiltersAndSort() { sortBy = document.getElementById('sortBy').value; typeFilter = document.getElementById('typeFilter').value; companyFilter = document.getElementById('companyFilter').value; refreshCurrentView(); }
function toggleProfileMenu() { document.getElementById('profileMenu').classList.toggle('show'); }
function openProfileEdit() { document.getElementById('editName').value = currentUser.name || ''; openModal('profileEditModal'); }
async function saveProfile() { currentUser.name = document.getElementById('editName').value; const file = document.getElementById('editImage').files[0]; if (file) { const reader = new FileReader(); reader.onload = async (e) => { currentUser.image = e.target.result; await db.users.update(currentUser.id, { name: currentUser.name, image: currentUser.image }); loadUserProfile(); closeModal('profileEditModal'); }; reader.readAsDataURL(file); } else { await db.users.update(currentUser.id, { name: currentUser.name }); loadUserProfile(); closeModal('profileEditModal'); } }
function openSettings() { openModal('settingsModal'); }
function toggleDarkMode() { document.body.classList.toggle('dark-mode'); localStorage.setItem('darkMode', document.body.classList.contains('dark-mode')); closeModal('settingsModal'); }
function showAbout() { alert('Pharmacy Manager Pro\nنسخة متطورة مع دعم قاعدة بيانات متقدمة، تصدير، إشعارات، وحذف مجمع.'); }

// Event listeners
document.getElementById('loginBtn').onclick = async () => { const email = document.getElementById('loginEmail').value; const pass = document.getElementById('loginPassword').value; if (await login(email, pass)) document.getElementById('loginMessage').innerText = ''; else document.getElementById('loginMessage').innerText = 'بيانات غير صحيحة'; };
document.getElementById('registerBtn').onclick = async () => { const email = document.getElementById('loginEmail').value; const pass = document.getElementById('loginPassword').value; if (await register(email, pass, email.split('@')[0])) document.getElementById('loginMessage').innerText = ''; else document.getElementById('loginMessage').innerText = 'البريد موجود مسبقاً'; };
document.querySelectorAll('.main-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

// Load saved user and init
(async () => {
    await initDemoData();
    const savedId = localStorage.getItem('currentUserId');
    if (savedId) {
        currentUser = await db.users.get(parseInt(savedId));
        if (currentUser) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('appSection').style.display = 'block';
            loadUserProfile();
            refreshCurrentView();
            checkExpiryNotifications();
        } else { document.getElementById('loginSection').style.display = 'flex'; }
    } else { document.getElementById('loginSection').style.display = 'flex'; }
    if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') Notification.requestPermission();
})();