
    // Firebase hanya diaktifkan untuk mode ADMIN. Mode KASIR berjalan tanpa
    // inisialisasi Firebase/Firestore/Cloud Functions agar checkout dan struk
    // benar-benar lokal/offline.
    const firebaseConfig = {
      apiKey: "AIzaSyDXV84dKaQnb8i_TZj5TScE_l-QkpNvCmk",
      authDomain: "toko-bung-edi.firebaseapp.com",
      projectId: "toko-bung-edi",
      storageBucket: "toko-bung-edi.firebasestorage.app",
      messagingSenderId: "428646259191",
      appId: "1:428646259191:web:eddcaef9c884f8d6e876f2",
      measurementId: "G-45C6D8KNXG"
    };

    let db = null;
    let isFirebaseReady = false;
    let firebaseLoadPromise = null;
    let firebaseUnsubscribers = [];

    function loadExternalScript(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
        if (existing) {
          if (existing.dataset.loaded === 'true') return resolve();
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`Gagal memuat ${src}`)), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.dynamicSrc = src;
        script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Gagal memuat ${src}`)), { once: true });
        document.head.appendChild(script);
      });
    }

    async function ensureFirebaseReady() {
      if (isFirebaseReady && db) return true;
      if (firebaseLoadPromise) return firebaseLoadPromise;
      firebaseLoadPromise = (async () => {
        try {
          await loadExternalScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
          await loadExternalScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js');
          await loadExternalScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-functions-compat.js');
          if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
          db = firebase.firestore();
          isFirebaseReady = true;
          setCloudStatus(true);
          return true;
        } catch (e) {
          console.error('Firebase admin initialization gagal:', e);
          db = null;
          isFirebaseReady = false;
          setCloudStatus(false);
          throw e;
        } finally {
          firebaseLoadPromise = null;
        }
      })();
      return firebaseLoadPromise;
    }

    async function disconnectFirebase() {
      firebaseUnsubscribers.forEach(unsub => { try { unsub(); } catch (_) {} });
      firebaseUnsubscribers = [];
      try {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
          await firebase.app().delete();
        }
      } catch (e) {
        console.warn('Firebase disconnect:', e);
      }
      db = null;
      isFirebaseReady = false;
      cloudFunctions = null;
      setCloudStatus(false);
    }

    function setCloudStatus(connected) {
      const dDot = document.getElementById('cloud-indicator-desktop');
      const mDot = document.getElementById('cloud-indicator-mobile');
      const text = document.getElementById('cloud-status-text');

      if (connected) {
        if (dDot) dDot.className = "w-2 h-2 rounded-full bg-emerald-500 inline-block";
        if (mDot) mDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
        if (text) text.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span> Cloud Connected`;
      } else {
        if (dDot) dDot.className = "w-2 h-2 rounded-full bg-amber-400 inline-block";
        if (mDot) mDot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
        if (text) text.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span> Local / Offline`;
      }
    }

    let cloudFunctions = null;
    let checkoutInProgress = false;
    let transactionPage = 1;
    const TRANSACTION_PAGE_SIZE = 50;

    function getCloudFunction(name) {
      if (!isFirebaseReady || typeof firebase === 'undefined' || typeof firebase.functions !== 'function') return null;
      if (!cloudFunctions) {
        // Firebase Functions Compat menerima Firebase App, bukan string region
        // sebagai argumen pertama. Region dipasang pada instance Functions milik app.
        const app = firebase.app();
        cloudFunctions = app.functions('asia-southeast1');
      }
      return cloudFunctions.httpsCallable(name);
    }

    function makeOperationId(prefix) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return `${prefix}-${window.crypto.randomUUID()}`;
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }

    function currentActorPayload() {
      return {
        name: currentUser?.name || currentUser?.nama || 'User',
        username: currentUser?.username || '',
        role: currentUser?.role || 'kasir'
      };
    }

    // STATE LOKAL
    let products = [
      { id: '1', kode: 'P001', barcode: '8998866200225', nama: 'Indomie Goreng Spesial', kategori: 'Sembako', hModal: 2600, hJual: 3500, hGrosir: 3100, stok: 65 },
      { id: '2', kode: 'P002', barcode: '8992775311029', nama: 'Aqua Botol 600ml', kategori: 'Minuman', hModal: 2000, hJual: 3000, hGrosir: 2500, stok: 48 },
      { id: '3', kode: 'P003', barcode: '8993175538059', nama: 'Teh Pucuk Harum 350ml', kategori: 'Minuman', hModal: 2800, hJual: 4000, hGrosir: 3300, stok: 35 }
    ];
    let members = [
      { id: 'M001', nama: 'Pak Joko', phone: '62851327958234', alamat: 'Karangturi', poin: 15 },
      { id: 'M002', nama: 'Ibu Siti', phone: '6281234567890', alamat: 'Turonggo', poin: 8 }
    ];
    let transactions = [];
    let stokLogs = [];
    let returs = [];
    let pemasukans = [];
    let pengeluarans = [];
    let brilinks = [];
    let appUsers = [
      { id: '1', nama: 'Owner Admin', username: 'tokobungedi', passwordHash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', role: 'ADMIN', status: 'AKTIF', dibuat: '11 Sep 2026, 18.24 WIB' },
      { id: '2', nama: 'Kasir Utama', username: 'tokobungedi', passwordHash: '2c7ee7ade401a7cef9ef4dad9978998cf42ed805243d6c91f89408c6097aa571', role: 'KASIR', status: 'AKTIF', dibuat: '11 Sep 2026, 18.24 WIB' }
    ];
    let aktivitasLogs = [];

    let storeInfo = { name: 'TOKO BUNG EDI', address: 'Jalan Turonggo karangturi', phone: '0851327958234' };
    let currentUser = null;
    let cart = [];
    let activeCartItemId = null;
    let kasirCategory = 'semua';
    let filterMenipisOnly = false;
    let activeReturTab = 'semua';
    let activeLaporanTab = 'toko';
    let activeBarangSubTab = 'katalog';
    let activePengeluaranTab = 'semua';
    let selectedProductIds = new Set();
    let lastActiveTxForReceipt = null;


    // ============================================================
    // LOCAL POS STORAGE (IndexedDB)
    // Kasir menyimpan data di perangkat dan tetap hidup setelah refresh.
    // Satu record state membuat snapshot lokal konsisten dan mudah dipulihkan.
    // ============================================================
    const LOCAL_DB_NAME = 'toko-bung-edi-pos-local';
    const LOCAL_DB_VERSION = 1;
    const LOCAL_STATE_KEY = 'state';
    let localDb = null;
    let localDbPromise = null;
    let localPersistTimer = null;
    let localPersistInProgress = false;
    let localPersistQueued = false;
    let localStateReady = Promise.resolve(false);
    let localCounters = { transactions: {}, brilinks: {} };

    function cloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function openLocalDb() {
      if (localDb) return Promise.resolve(localDb);
      if (localDbPromise) return localDbPromise;
      localDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('state')) database.createObjectStore('state', { keyPath: 'key' });
        };
        request.onsuccess = () => { localDb = request.result; resolve(localDb); };
        request.onerror = () => reject(request.error || new Error('IndexedDB tidak tersedia.'));
      }).catch(err => {
        console.error('Local database error:', err);
        localDb = null;
        throw err;
      });
      return localDbPromise;
    }

    function getLocalStateSnapshot() {
      return {
        key: LOCAL_STATE_KEY,
        version: 2,
        savedAt: Date.now(),
        products: cloneJson(products),
        members: cloneJson(members),
        transactions: cloneJson(transactions),
        stokLogs: cloneJson(stokLogs),
        returs: cloneJson(returs),
        pemasukans: cloneJson(pemasukans),
        pengeluarans: cloneJson(pengeluarans),
        brilinks: cloneJson(brilinks),
        appUsers: cloneJson(appUsers).map(u => { const safe = { ...u }; delete safe.password; return safe; }),
        aktivitasLogs: cloneJson(aktivitasLogs),
        storeInfo: cloneJson(storeInfo),
        counters: cloneJson(localCounters)
      };
    }

    async function persistLocalState() {
      if (localPersistInProgress) {
        localPersistQueued = true;
        return;
      }
      localPersistInProgress = true;
      try {
        const snapshot = getLocalStateSnapshot();
        try {
          const database = await openLocalDb();
          await new Promise((resolve, reject) => {
            const tx = database.transaction('state', 'readwrite');
            tx.objectStore('state').put(snapshot);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('Gagal menyimpan data lokal.'));
            tx.onabort = () => reject(tx.error || new Error('Penyimpanan lokal dibatalkan.'));
          });
        } catch (idbErr) {
          console.warn('IndexedDB tidak tersedia, memakai localStorage:', idbErr);
          localStorage.setItem('tbe-local-state', JSON.stringify(snapshot));
        }
        try { localStorage.setItem('tbe-local-last-save', String(snapshot.savedAt)); } catch (_) {}
      } finally {
        localPersistInProgress = false;
        if (localPersistQueued) {
          localPersistQueued = false;
          setTimeout(() => persistLocalState().catch(console.error), 0);
        }
      }
    }

    function scheduleLocalPersist(delay = 350) {
      if (currentUser && currentUser.role === 'admin' && isFirebaseReady) return;
      clearTimeout(localPersistTimer);
      localPersistTimer = setTimeout(() => persistLocalState().catch(err => console.error('Persist lokal:', err)), delay);
    }

    async function loadLocalState() {
      try {
        const database = await openLocalDb();
        const snapshot = await new Promise((resolve, reject) => {
          const tx = database.transaction('state', 'readonly');
          const req = tx.objectStore('state').get(LOCAL_STATE_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        if (!snapshot) {
          ensureLocalDefaultAccounts();
          await persistLocalState();
          return false;
        }
        if (Array.isArray(snapshot.products) && snapshot.products.length) products = snapshot.products;
        if (Array.isArray(snapshot.members)) members = snapshot.members;
        if (Array.isArray(snapshot.transactions)) transactions = snapshot.transactions;
        if (Array.isArray(snapshot.stokLogs)) stokLogs = snapshot.stokLogs;
        if (Array.isArray(snapshot.returs)) returs = snapshot.returs;
        if (Array.isArray(snapshot.pemasukans)) pemasukans = snapshot.pemasukans;
        if (Array.isArray(snapshot.pengeluarans)) pengeluarans = snapshot.pengeluarans;
        if (Array.isArray(snapshot.brilinks)) brilinks = snapshot.brilinks;
        if (Array.isArray(snapshot.appUsers) && snapshot.appUsers.length) appUsers = snapshot.appUsers;
        if (Array.isArray(snapshot.aktivitasLogs)) aktivitasLogs = snapshot.aktivitasLogs;
        if (snapshot.storeInfo) storeInfo = { ...storeInfo, ...snapshot.storeInfo };
        if (snapshot.counters) localCounters = { transactions: {}, brilinks: {}, ...snapshot.counters };
        transactions.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
        stokLogs.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
        // Rebuild counters dari data historis agar upgrade dari versi lama tidak menghasilkan nomor duplikat.
        localCounters = { transactions: {}, brilinks: {}, ...(snapshot.counters || {}) };
        transactions.forEach(tx => {
          const match = String(tx.id || '').match(/^TRX-(\d{8})-(\d{4,})$/);
          if (match) localCounters.transactions[`${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`] = Math.max(Number(localCounters.transactions[`${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`]) || 0, Number(match[2]) || 0);
        });
        ensureLocalDefaultAccounts();
        brilinks.forEach(b => {
          const match = String(b.id || '').match(/^BRI-(\d{8})-(\d{4,})$/);
          if (match) localCounters.brilinks[`${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`] = Math.max(Number(localCounters.brilinks[`${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`]) || 0, Number(match[2]) || 0);
        });
        return true;
      } catch (err) {
        ensureLocalDefaultAccounts();
        console.error('Gagal memuat IndexedDB:', err);
        try {
          const raw = localStorage.getItem('tbe-local-state');
          if (raw) {
            const fallback = JSON.parse(raw);
            if (Array.isArray(fallback.products) && fallback.products.length) products = fallback.products;
            if (Array.isArray(fallback.members)) members = fallback.members;
            if (Array.isArray(fallback.transactions)) transactions = fallback.transactions;
            if (Array.isArray(fallback.stokLogs)) stokLogs = fallback.stokLogs;
            if (Array.isArray(fallback.returs)) returs = fallback.returs;
            if (Array.isArray(fallback.pemasukans)) pemasukans = fallback.pemasukans;
            if (Array.isArray(fallback.pengeluarans)) pengeluarans = fallback.pengeluarans;
            if (Array.isArray(fallback.brilinks)) brilinks = fallback.brilinks;
            if (Array.isArray(fallback.appUsers) && fallback.appUsers.length) appUsers = fallback.appUsers;
            if (Array.isArray(fallback.aktivitasLogs)) aktivitasLogs = fallback.aktivitasLogs;
            if (fallback.storeInfo) storeInfo = { ...storeInfo, ...fallback.storeInfo };
            if (fallback.counters) localCounters = { transactions: {}, brilinks: {}, ...fallback.counters };
            return true;
          }
        } catch (fallbackErr) { console.error('Fallback localStorage gagal:', fallbackErr); }
        return false;
      }
    }

    function nextLocalNumber(kind, dateKey) {
      const bucket = localCounters[kind] || (localCounters[kind] = {});
      const next = (Number(bucket[dateKey]) || 0) + 1;
      bucket[dateKey] = next;
      return next;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
    }


    function ensureLocalDefaultAccounts() {
      const hasAdmin = appUsers.some(u => String(u.username || '').toLowerCase() === 'tokobungedi' && String(u.role || '').toUpperCase() === 'ADMIN' && !!u.passwordHash);
      const hasKasir = appUsers.some(u => String(u.username || '').toLowerCase() === 'tokobungedi' && String(u.role || '').toUpperCase() === 'KASIR' && !!u.passwordHash);
      if (!hasAdmin) appUsers.unshift({ id:'local-admin', nama:'Owner Admin', username:'tokobungedi', passwordHash:'8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', role:'ADMIN', status:'AKTIF', dibuat:'Lokal' });
      if (!hasKasir) appUsers.push({ id:'local-kasir', nama:'Kasir Utama', username:'tokobungedi', passwordHash:'2c7ee7ade401a7cef9ef4dad9978998cf42ed805243d6c91f89408c6097aa571', role:'KASIR', status:'AKTIF', dibuat:'Lokal' });
    }

    async function loadAdminUsersForLogin() {
      if (!isFirebaseReady || !db) return;
      try {
        const snap = await db.collection('appUsers').get();
        if (!snap.empty) {
          appUsers = [];
          for (const doc of snap.docs) {
            const data = doc.data() || {};
            const user = { id: doc.id, ...data, username: String(data.username || '').trim(), role: String(data.role || 'KASIR').trim().toUpperCase() };
            if (data.passwordHash) user.passwordHash = String(data.passwordHash);
            else if (data.password) {
              user.passwordHash = await hashPassword(String(data.password));
              try { await db.collection('appUsers').doc(doc.id).set({ passwordHash: user.passwordHash, password: firebase.firestore.FieldValue.delete() }, { merge: true }); } catch (migrationErr) { console.warn('Migrasi password user cloud gagal:', migrationErr); }
            }
            delete user.password;
            appUsers.push(user);
          }
        }
      } catch (err) {
        console.warn('Tidak dapat membaca akun Admin dari cloud; memakai akun lokal:', err);
      }
    }

    // REALTIME DATABASE SYNC
    function initRealtimeListeners() {
      if (!isFirebaseReady || !db) return;

      firebaseUnsubscribers.push(db.collection("products").onSnapshot(snapshot => {
        if (!snapshot.empty) {
          products = [];
          snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
          renderProductsTable();
          renderKasirCategoryPills();
          renderDashboard();
          renderPopupBarangList();
          refreshProductCategories();
        } else {
          products.forEach(p => syncToCloud("products", p.id, p));
        }
      }, err => console.error("Err products sync:", err)));

      firebaseUnsubscribers.push(db.collection("members").onSnapshot(snapshot => {
        if (!snapshot.empty) {
          members = [];
          snapshot.forEach(doc => members.push({ id: doc.id, ...doc.data() }));
          renderMemberTable();
          renderKasirMemberDropdown();
        } else {
          members.forEach(m => syncToCloud("members", m.id, m));
        }
      }, err => console.error("Err members sync:", err)));

      firebaseUnsubscribers.push(db.collection("transactions").onSnapshot(snapshot => {
        transactions = [];
        snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
        transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderTransaksiTable();
        renderDashboard();
        renderLaporan();
        renderKasTable();
      }, err => console.error("Err tx sync:", err)));

      firebaseUnsubscribers.push(db.collection("stokLogs").onSnapshot(snapshot => {
        stokLogs = [];
        snapshot.forEach(doc => stokLogs.push({ id: doc.id, ...doc.data() }));
        stokLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderStokTable();
      }, err => console.error("Err stok sync:", err)));

      firebaseUnsubscribers.push(db.collection("returs").onSnapshot(snapshot => {
        returs = [];
        snapshot.forEach(doc => returs.push({ id: doc.id, ...doc.data() }));
        returs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderReturTable();
        renderKasTable();
      }, err => console.error("Err retur sync:", err)));

      firebaseUnsubscribers.push(db.collection("pemasukans").onSnapshot(snapshot => {
        pemasukans = [];
        snapshot.forEach(doc => pemasukans.push({ id: doc.id, ...doc.data() }));
        renderKasTable();
        renderDashboard();
        renderLaporan();
      }, err => console.error("Err pemasukan sync:", err)));

      firebaseUnsubscribers.push(db.collection("pengeluarans").onSnapshot(snapshot => {
        pengeluarans = [];
        snapshot.forEach(doc => pengeluarans.push({ id: doc.id, ...doc.data() }));
        renderKasTable();
        renderDashboard();
        renderLaporan();
      }, err => console.error("Err pengeluaran sync:", err)));

      firebaseUnsubscribers.push(db.collection("brilinks").onSnapshot(snapshot => {
        brilinks = [];
        snapshot.forEach(doc => brilinks.push({ id: doc.id, ...doc.data() }));
        brilinks.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderBriLinkTable();
        renderDashboard();
        renderLaporan();
        renderKasTable();
      }, err => console.error("Err brilink sync:", err)));

      firebaseUnsubscribers.push(db.collection("storeSettings").doc("main").onSnapshot(doc => {
        if (doc.exists) {
          const data = doc.data() || {};
          storeInfo = {
            name: String(data.name || storeInfo.name),
            address: String(data.address || storeInfo.address),
            phone: String(data.phone || storeInfo.phone)
          };
          applyStoreInfo();
        } else {
          syncToCloud("storeSettings", "main", storeInfo);
        }
      }, err => console.error("Err store settings sync:", err)));

      firebaseUnsubscribers.push(db.collection("appUsers").onSnapshot(snapshot => {
        if (!snapshot.empty) {
          appUsers = [];
          snapshot.forEach(doc => {
            const data = doc.data() || {};
            const user = { id: doc.id, ...data, username: String(data.username || '').trim(), role: String(data.role || 'KASIR').trim().toUpperCase() };
            if (data.passwordHash) user.passwordHash = String(data.passwordHash);
            else if (data.password) {
              hashPassword(String(data.password)).then(async hash => {
                try { await db.collection('appUsers').doc(doc.id).set({ passwordHash: hash, password: firebase.firestore.FieldValue.delete() }, { merge: true }); } catch (migrationErr) { console.warn('Migrasi password user cloud gagal:', migrationErr); }
              });
            }
            delete user.password;
            appUsers.push(user);
          });
          // Pastikan akun admin utama tetap tersedia apabila data cloud belum lengkap.
          if (!appUsers.some(u => String(u.username).trim().toLowerCase() === 'tokobungedi' && String(u.role).toUpperCase() === 'ADMIN')) {
            appUsers.unshift({ id: '1', nama: 'Owner Admin', username: 'tokobungedi', passwordHash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', role: 'ADMIN', status: 'AKTIF', dibuat: '11 Sep 2026, 18.24 WIB' });
          }
          if (!appUsers.some(u => String(u.username).trim().toLowerCase() === 'tokobungedi' && String(u.role).toUpperCase() === 'KASIR')) {
            appUsers.push({ id: '2', nama: 'Kasir Toko', username: 'tokobungedi', passwordHash: '2c7ee7ade401a7cef9ef4dad9978998cf42ed805243d6c91f89408c6097aa571', role: 'KASIR', status: 'AKTIF', dibuat: '11 Sep 2026, 18.24 WIB' });
          }
          renderUsersTable();
        } else {
          appUsers.forEach(u => syncToCloud("appUsers", u.id, u));
        }
      }, err => console.error("Err users sync:", err)));

      firebaseUnsubscribers.push(db.collection("aktivitasLogs").onSnapshot(snapshot => {
        aktivitasLogs = [];
        snapshot.forEach(doc => aktivitasLogs.push({ id: doc.id, ...doc.data() }));
        aktivitasLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        renderAktivitas();
      }, err => console.error("Err log sync:", err)));
    }

    async function syncToCloud(col, docId, data) {
      if (!isFirebaseReady || !db) return true;
      try {
        await db.collection(col).doc(String(docId)).set(data, { merge: true });
        return true;
      } catch (err) {
        console.error(`Sync fail [${col}]:`, err);
        throw err;
      }
    }

    async function deleteFromCloud(col, docId) {
      if (!isFirebaseReady || !db) return true;
      try {
        await db.collection(col).doc(String(docId)).delete();
        return true;
      } catch (err) {
        console.error(`Delete fail [${col}]:`, err);
        throw err;
      }
    }

    // SCANNER HARDWARE & DETEKSI OTOMATIS
    let barcodeScannerBuffer = "";
    let lastKeyTime = 0;
    let isScannerConnected = false;

    function setScannerReadyState(connected) {
      const badge = document.getElementById('scanner-badge');
      const text = document.getElementById('scanner-status-text');
      if (!badge || !text) return;

      if (connected) {
        badge.className = "flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-lg text-xs shrink-0 shadow-sm animate-pulse";
        text.innerText = "Scanner Siap";
      } else {
        badge.className = "flex items-center space-x-1.5 px-2.5 py-1 bg-gray-100 text-gray-500 font-bold rounded-lg text-xs shrink-0";
        text.innerText = "Siap Scan";
      }
    }

    // ============================================================
    // KASIR KLASIK - KEYBOARD ENGINE
    // ============================================================
    let activeCartRowIndex = -1;
    let activePopupIndex = 0;

    function isKasirPageActive() {
      const page = document.getElementById('page-kasir');
      return page && !page.classList.contains('hidden');
    }

    function focusKasirSearch(selectAll = true) {
      const el = document.getElementById('kasir-search');
      if (!el) return;
      el.focus();
      if (selectAll) el.select();
    }


    // Mengosongkan seluruh input pada form setelah data berhasil dijalankan/disimpan.
    function clearExecutedForm(formId, options = {}) {
      const form = document.getElementById(formId);
      if (!form) return;
      form.reset();
      form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
        if (!options.keepIds || !options.keepIds.includes(el.id)) el.value = '';
      });
      form.querySelectorAll('select').forEach(el => {
        if (!options.keepIds || !options.keepIds.includes(el.id)) el.selectedIndex = 0;
      });
    }

    function syncActiveCartRow() {
      const rows = [...document.querySelectorAll('#cart-table-body tr[data-cart-index]')];
      rows.forEach(r => r.classList.remove('active-cart-row'));
      if (activeCartRowIndex >= 0 && rows[activeCartRowIndex]) {
        rows[activeCartRowIndex].classList.add('active-cart-row');
        rows[activeCartRowIndex].scrollIntoView({block:'nearest'});
        activeCartItemId = rows[activeCartRowIndex].dataset.productId;
      }
    }

    function setActiveCartRow(index, focusQty = false) {
      const rows = [...document.querySelectorAll('#cart-table-body tr[data-cart-index]')];
      if (!rows.length) {
        activeCartRowIndex = -1;
        activeCartItemId = null;
        focusKasirSearch();
        return;
      }
      activeCartRowIndex = Math.max(0, Math.min(index, rows.length - 1));
      syncActiveCartRow();
      if (focusQty) {
        const input = rows[activeCartRowIndex].querySelector('[data-qty-input="true"]');
        if (input) { input.focus(); input.select(); }
      }
    }

    function moveActiveCartRow(delta) {
      const rows = [...document.querySelectorAll('#cart-table-body tr[data-cart-index]')];
      if (!rows.length) return focusKasirSearch();
      const next = activeCartRowIndex < 0 ? (delta > 0 ? 0 : rows.length - 1) : activeCartRowIndex + delta;
      setActiveCartRow(next, false);
    }

    function focusFirstCartQty() {
      const rows = [...document.querySelectorAll('#cart-table-body tr[data-cart-index]')];
      if (!rows.length) { focusKasirSearch(); return; }
      setActiveCartRow(activeCartRowIndex >= 0 ? activeCartRowIndex : 0, true);
    }

    function handleClassicTableKey(event, productId, rowIndex) {
      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;

      activeCartRowIndex = rowIndex;
      activeCartItemId = productId;

      if (event.key === 'Enter') {
        event.preventDefault();
        const rows = [...document.querySelectorAll('#cart-table-body tr[data-cart-index]')];
        if (rowIndex < rows.length - 1) {
          setActiveCartRow(rowIndex + 1, true);
        } else {
          focusKasirSearch();
        }
        return;
      }

      if (event.key === 'ArrowDown') { event.preventDefault(); moveActiveCartRow(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveActiveCartRow(-1); return; }

      if (event.key === 'Delete' || (event.ctrlKey && event.key === 'Backspace')) {
        event.preventDefault();
        removeCartItem(productId);
        const nextIndex = Math.min(rowIndex, cart.length - 1);
        activeCartRowIndex = nextIndex;
        syncActiveCartRow();
        focusKasirSearch();
        return;
      }

      if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'e' || event.key === 'E')) {
        event.preventDefault(); togglePriceMode(productId, 'eceran'); return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'g' || event.key === 'G')) {
        event.preventDefault(); togglePriceMode(productId, 'grosir'); return;
      }
    }

    function handleQtyKeydown(event, productId, rowIndex) {
      handleClassicTableKey(event, productId, rowIndex);
    }

    window.addEventListener("keydown", function(e) {
      const target = e.target;
      if (!document.getElementById('modal-kalkulator')?.classList.contains('hidden')) {
        if (e.key === 'Escape') { e.preventDefault(); closeModal('modal-kalkulator'); return; }
        if (e.key === 'Enter') { e.preventDefault(); calcEquals(); return; }
        if (/^[0-9+\-*/.()]$/.test(e.key)) { e.preventDefault(); calcPress(e.key); return; }
        if (e.key === 'Backspace') { e.preventDefault(); const d=document.getElementById('calc-display'); d.value=d.value.slice(0,-1); return; }
      }
      const tag = (target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      const modalOpen = [...document.querySelectorAll('[id^="modal-"]')].some(m => !m.classList.contains('hidden'));

      // Tombol fungsi POS tetap bekerja walaupun kursor berada di input.
      if (e.key === 'F1') { e.preventDefault(); openCalculator(); return; }
      if (e.key === 'F2' || e.key === 'F3') {
        e.preventDefault();
        if (isKasirPageActive()) openModalKatalogBarang();
        return;
      }
      if (e.key === 'F4') { e.preventDefault(); setAllPriceMode('eceran'); return; }
      if (e.key === 'F5') { e.preventDefault(); setAllPriceMode('grosir'); return; }
      if (e.key === 'F6') { e.preventDefault(); clearCart(); focusKasirSearch(); return; }
      if (e.key === 'F8') { e.preventDefault(); navigate('member'); return; }
      if (e.key === 'F9') {
        e.preventDefault(); openCheckoutModal(); return;
      }
      if (e.key === 'F10') { e.preventDefault(); focusFirstCartQty(); return; }

      // Escape menutup modal terlebih dahulu.
      if (e.key === 'Escape') {
        const opened = [...document.querySelectorAll('[id^="modal-"]')].find(m => !m.classList.contains('hidden'));
        if (opened) { e.preventDefault(); closeModal(opened.id); return; }
        if (isKasirPageActive()) { e.preventDefault(); focusKasirSearch(); return; }
      }

      // Navigasi modul.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const pages = ['dashboard','kasir','barang','member','transaksi','retur','pemasukan','pengeluaran','brilink'];
        const page = pages[Number(e.key) - 1];
        if (page) { e.preventDefault(); navigate(page); return; }
      }

      // Jangan mengambil alih ketikan normal.
      if (typing) {
        // Ctrl+Backspace/Delete dan shortcut E/G ditangani khusus di qty input.
        return;
      }

      if (!isKasirPageActive() || modalOpen) return;

      if (e.key === 'ArrowDown') { e.preventDefault(); moveActiveCartRow(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveActiveCartRow(-1); return; }
      if (e.key === 'Delete') {
        e.preventDefault();
        if (activeCartItemId) { removeCartItem(activeCartItemId); focusKasirSearch(); }
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        if (activeCartItemId) { e.preventDefault(); togglePriceMode(activeCartItemId, 'eceran'); }
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        if (activeCartItemId) { e.preventDefault(); togglePriceMode(activeCartItemId, 'grosir'); }
      }
    });

    function handleBarcodeFieldKey(event, inputId) {
      if (event.key !== 'Enter') return;
      const input = document.getElementById(inputId);
      if (!input) return;
      const code = input.value.trim();
      if (!code) return;
      event.preventDefault();
      isScannerConnected = true;
      setScannerReadyState(true);
      handleScannedBarcodeAuto(code);
    }

    function handleScannedBarcodeAuto(code) {
      if (!isScannerConnected) {
        isScannerConnected = true;
        setScannerReadyState(true);
      }

      const modalBarang = document.getElementById("modal-barang");
      const modalSimple = document.getElementById("modal-barang-simple");

      if (modalBarang && !modalBarang.classList.contains("hidden")) {
        const inp = document.getElementById("barang-barcode");
        if (inp) {
          inp.value = code;
          showToast(`Barcode Discan: ${code}`);
          document.getElementById("barang-nama")?.focus();
        }
        return;
      }

      if (modalSimple && !modalSimple.classList.contains("hidden")) {
        const inp = document.getElementById("simple-barcode");
        if (inp) {
          inp.value = code;
          showToast(`Barcode Discan: ${code}`);
          document.getElementById("simple-nama")?.focus();
        }
        return;
      }

      processBarcodeToCart(code);
    }

    function processBarcodeToCart(barcode) {
      if (!barcode) return;
      let raw = String(barcode).trim();

      // Format kasir klasik: 10*barcode atau 10xbarcode.
      let requestedQty = 1;
      const qtyPrefix = raw.match(/^(\d+)\s*[xX*]\s*(.+)$/);
      if (qtyPrefix) {
        requestedQty = Math.max(1, parseInt(qtyPrefix[1], 10) || 1);
        raw = qtyPrefix[2].trim();
      }

      const bcode = raw;
      const lower = bcode.toLowerCase();
      const matched = products.find(p =>
        (p.barcode && String(p.barcode).trim().toLowerCase() === lower) ||
        (p.kode && String(p.kode).trim().toLowerCase() === lower)
      );

      if (matched) {
        addToCart(matched.id, {focusQty:false, requestedQty});
        const s = document.getElementById('kasir-search');
        if (s) { s.value = ''; s.focus(); }
        showToast(`+${requestedQty} ${matched.nama}`);
        return;
      }

      // Jika bukan barcode/kode exact, cari nama dan pilih hasil pertama.
      const byName = products.filter(p => String(p.nama || '').toLowerCase().includes(lower) && Number(p.stok) > 0);
      if (byName.length === 1) {
        addToCart(byName[0].id, {focusQty:false, requestedQty});
        const s = document.getElementById('kasir-search');
        if (s) { s.value = ''; s.focus(); }
        showToast(`+${requestedQty} ${byName[0].nama}`);
      } else {
        showToast(byName.length > 1 ? 'Banyak hasil. Tekan F2/F3 untuk daftar barang.' : `Barang tidak ditemukan: ${bcode}`);
        document.getElementById('kasir-search')?.select();
      }
    }

    function handleBarcodeScannerKey(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const query = e.target.value.trim();
      if (!query) return;
      processBarcodeToCart(query);
    }

    // ============================================================
    // POPUP KATALOG - FULL KEYBOARD
    // ============================================================
    function openModalKatalogBarang() {
      activePopupIndex = 0;

      // Setiap kali daftar barang dibuka, kosongkan keyword sebelumnya.
      // Jadi kasir selalu siap mengetik keyword/barcode baru.
      const input = document.getElementById('popup-barang-search');
      if (input) {
        input.value = '';
      }

      renderKasirCategoryPills();
      renderPopupBarangList();
      openModal('modal-katalog-barang');
      setTimeout(() => {
        const searchInput = document.getElementById('popup-barang-search');
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
          searchInput.select();
        }
        renderPopupBarangList();
      }, 100);
    }

    function getPopupRows() {
      return [...document.querySelectorAll('#popup-barang-list .classic-popup-row')];
    }

    function setPopupActive(index) {
      const rows = getPopupRows();
      if (!rows.length) return;
      activePopupIndex = Math.max(0, Math.min(index, rows.length - 1));
      rows.forEach((r,i) => r.classList.toggle('active-popup-row', i === activePopupIndex));
      rows[activePopupIndex]?.scrollIntoView({block:'nearest'});
    }

    function handlePopupSearchKey(event) {
      const rows = getPopupRows();
      if (event.key === 'ArrowDown') {
        event.preventDefault(); setPopupActive(activePopupIndex + 1); return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault(); setPopupActive(activePopupIndex - 1); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); closeModal('modal-katalog-barang'); focusKasirSearch(); return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (rows.length) {
          const id = rows[activePopupIndex]?.dataset.productId;
          if (id) {
            selectProductFromPopup(id);
            return;
          }
        }
        const query = event.target.value.trim().toLowerCase();
        if (!query) return;
        const exact = products.find(p => String(p.barcode||'').toLowerCase() === query || String(p.kode||'').toLowerCase() === query);
        if (exact) {
          selectProductFromPopup(exact.id);
          return;
        }
        showToast('Barang tidak ditemukan');
      }
    }

    function renderPopupBarangList() {
      const container = document.getElementById('popup-barang-list');
      if (!container) return;
      const search = (document.getElementById('popup-barang-search')?.value || '').toLowerCase().trim();

      const filtered = products.filter(p => {
        if (!search) return true;
        return String(p.nama||'').toLowerCase().includes(search) ||
               String(p.kode||'').toLowerCase().includes(search) ||
               String(p.barcode||'').toLowerCase().includes(search);
      }).slice(0, 200);

      if (!filtered.length) {
        container.innerHTML = `<div class="p-10 text-center text-gray-500 font-mono text-sm">BARANG TIDAK DITEMUKAN</div>`;
        activePopupIndex = 0;
        return;
      }

      activePopupIndex = Math.min(activePopupIndex, filtered.length - 1);
      container.innerHTML = filtered.map((p,index) => {
        const grosir = p.hGrosir || Math.round((p.hJual || 0) * 0.9);
        const disabled = Number(p.stok) <= 0;
        return `
          <div class="classic-popup-row ${index===activePopupIndex ? 'active-popup-row' : ''} ${disabled ? 'opacity-50' : ''}"
               data-product-id="${p.id}"
               onclick="${disabled ? '' : `selectProductFromPopup('${p.id}')`}"
               title="${disabled ? 'Stok habis' : 'Enter untuk memilih'}">
            <div class="p-code">${escapeHtml(p.barcode || p.kode)}</div>
            <div class="p-name">${escapeHtml(p.nama)}</div>
            <div class="p-price">Rp${Number(p.hJual||0).toLocaleString('id-ID')}</div>
            <div class="p-price-grosir">Rp${Number(grosir||0).toLocaleString('id-ID')}</div>
            <div class="p-stock">${p.stok}</div>
            <div class="p-price">${disabled ? 'HABIS' : 'PILIH'}</div>
          </div>
        `;
      }).join('');
    }

    // Memilih produk dari popup: tambah ke keranjang lalu tutup popup otomatis.
    function selectProductFromPopup(productId) {
      const prod = products.find(p => String(p.id) === String(productId));

      if (!prod || Number(prod.stok) <= 0) {
        showToast('Stok barang fisik habis!');
        return;
      }

      addToCart(productId, {focusQty:false});

      // Bersihkan pencarian setelah barang masuk ke keranjang.
      const input = document.getElementById('popup-barang-search');
      if (input) input.value = '';
      renderPopupBarangList();

      closeModal('modal-katalog-barang');
      focusKasirSearch();
    }

    function renderKasirCategoryPills() {
      const container = document.getElementById('popup-cat-pills');
      if (!container) return;
      container.innerHTML = '';
    }

    function filterKasirCat(cat) { kasirCategory = cat; renderPopupBarangList(); }
    function renderKasirCatalog() {
      // Input kasir utama hanya sebagai scanner/search. Daftar popup mengikuti teksnya.
    }

    // ============================================================
    // CART
    // ============================================================
    function addToCart(productId, options = {}) {
      const prod = products.find(p => String(p.id) === String(productId));
      if (!prod || Number(prod.stok) <= 0) {
        showToast('Stok barang fisik habis!');
        return;
      }

      const requestedQty = Math.max(1, parseInt(options.requestedQty, 10) || 1);
      const item = cart.find(c => String(c.id) === String(productId));

      if (item) {
        item.qty = Math.min(Number(prod.stok), item.qty + requestedQty);
        if (item.qty >= Number(prod.stok) && requestedQty > 0) showToast(`Stok maksimal ${prod.stok}`);
      } else {
        const qty = Math.min(requestedQty, Number(prod.stok));
        cart.push({...prod, qty, priceMode:'eceran', currentPrice:Number(prod.hJual)||0});
        if (requestedQty > qty) showToast(`Jumlah dibatasi stok ${prod.stok}`);
      }

      activeCartItemId = productId;
      activeCartRowIndex = cart.findIndex(c => String(c.id) === String(productId));
      updateCartView();

      // Scanner selalu kembali ke input barcode.
      if (options.focusQty === true) setTimeout(() => focusCartQty(productId), 50);
      else setTimeout(() => focusKasirSearch(), 0);
    }

    function togglePriceMode(productId, mode) {
      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;
      activeCartItemId = productId;
      activeCartRowIndex = cart.findIndex(c => String(c.id) === String(productId));
      item.priceMode = mode;
      item.currentPrice = mode === 'grosir' ? Number(item.hGrosir || Math.round((item.hJual||0)*0.9)) : Number(item.hJual||0);
      updateCartView();
      focusCartQty(productId);
    }

    function setAllPriceMode(mode) {
      if (!cart.length) { showToast('Keranjang masih kosong'); return; }
      cart.forEach(item => {
        item.priceMode = mode;
        item.currentPrice = mode === 'grosir' ? Number(item.hGrosir || Math.round((item.hJual||0)*0.9)) : Number(item.hJual||0);
      });
      updateCartView();
      showToast(`Semua harga ${mode === 'grosir' ? 'GROSIR' : 'ECERAN'}`);
      focusKasirSearch();
    }

    function setCartQty(productId, value) {
      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;
      let qty = parseInt(value, 10);
      if (!Number.isFinite(qty)) return;
      qty = Math.max(1, qty);
      const maxStock = Number(item.stok) || 0;
      if (maxStock > 0 && qty > maxStock) {
        qty = maxStock;
        showToast(`QTY dibatasi stok ${maxStock}`);
      }
      item.qty = qty;
      activeCartItemId = productId;
      activeCartRowIndex = cart.findIndex(c => String(c.id) === String(productId));
      updateCartView();
    }

    function focusCartQty(productId) {
      const input = document.getElementById(`cart-qty-${CSS.escape(String(productId))}`);
      if (input) { input.focus(); input.select(); }
    }

    function updateCartQty(productId, delta) {
      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;
      item.qty += delta;
      const maxStock = Number(item.stok) || 0;
      if (maxStock > 0 && item.qty > maxStock) item.qty = maxStock;
      if (item.qty <= 0) cart = cart.filter(c => String(c.id) !== String(productId));
      activeCartRowIndex = cart.findIndex(c => String(c.id) === String(productId));
      activeCartItemId = activeCartRowIndex >= 0 ? cart[activeCartRowIndex].id : null;
      updateCartView();
    }

    function handleCartQtyKeydown(event, productId) {
      const rowIndex = cart.findIndex(c => String(c.id) === String(productId));
      handleClassicTableKey(event, productId, rowIndex);
    }

    function updateCartQtyFromInput(productId, input) {
      // Jangan render ulang tabel setiap tombol keyboard ditekan.
      // Jika tabel dirender ulang pada oninput, fokus input akan hilang
      // sehingga kasir harus klik lagi untuk mengetik angka berikutnya.
      if (input.value === '') return;

      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;

      let qty = parseInt(input.value, 10);
      if (!Number.isFinite(qty) || qty < 1) return;

      const maxStock = Number(item.stok) || 0;
      if (maxStock > 0 && qty > maxStock) {
        qty = maxStock;
        input.value = String(maxStock);
        showToast(`QTY dibatasi stok ${maxStock}`);
      }

      item.qty = qty;
      activeCartItemId = productId;
      activeCartRowIndex = cart.findIndex(c => String(c.id) === String(productId));

      // Perbarui total tanpa mengganti HTML input QTY.
      const totalItems = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      const totalPrice = cart.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.currentPrice || 0)), 0);
      const formattedTotal = 'Rp' + totalPrice.toLocaleString('id-ID');
      const countEl = document.getElementById('cart-count');
      const subtotalEl = document.getElementById('subtotal-val');
      const totalEl = document.getElementById('total-val');
      const classicTotal = document.getElementById('classic-total-display');
      const classicSub = document.getElementById('classic-kasir-sub');
      if (countEl) countEl.innerText = totalItems;
      if (subtotalEl) subtotalEl.innerText = formattedTotal;
      if (totalEl) totalEl.innerText = formattedTotal;
      if (classicTotal) classicTotal.innerText = formattedTotal;
      if (classicSub) classicSub.innerText = `${totalItems} Barang di Kasir`;
    }

    function normalizeCartQtyInput(productId, input) {
      const item = cart.find(c => String(c.id) === String(productId));
      if (!item) return;
      const qty = parseInt(input.value,10);
      input.value = Number.isFinite(qty) && qty > 0 ? item.qty : item.qty;
    }

    function removeCartItem(productId) {
      const oldIndex = cart.findIndex(c => String(c.id) === String(productId));
      cart = cart.filter(c => String(c.id) !== String(productId));
      if (activeCartRowIndex > oldIndex) activeCartRowIndex--;
      if (activeCartRowIndex >= cart.length) activeCartRowIndex = cart.length - 1;
      activeCartItemId = activeCartRowIndex >= 0 ? cart[activeCartRowIndex].id : null;
      updateCartView();
    }

    function clearCart() {
      cart = [];
      activeCartRowIndex = -1;
      activeCartItemId = null;
      updateCartView();
    }

    function updateCartView() {
      const tbody = document.getElementById('cart-table-body');
      const countEl = document.getElementById('cart-count');
      const subtotalEl = document.getElementById('subtotal-val');
      const totalEl = document.getElementById('total-val');
      const classicTotal = document.getElementById('classic-total-display');
      const classicSub = document.getElementById('classic-kasir-sub');
      const userName = document.getElementById('classic-kasir-name');

      if (userName) userName.innerText = currentUser?.name || '-';

      const totalItems = cart.reduce((sum,item) => sum + Number(item.qty||0), 0);
      const totalPrice = cart.reduce((sum,item) => sum + (Number(item.qty||0) * Number(item.currentPrice||0)), 0);
      const formattedTotal = 'Rp' + totalPrice.toLocaleString('id-ID');

      if (countEl) countEl.innerText = totalItems;
      if (subtotalEl) subtotalEl.innerText = formattedTotal;
      if (totalEl) totalEl.innerText = formattedTotal;
      if (classicTotal) classicTotal.innerText = formattedTotal;
      if (classicSub) classicSub.innerText = `${totalItems} Barang di Kasir`;

      if (!tbody) return;

      if (!cart.length) {
        tbody.innerHTML = `<tr class="classic-empty-row"><td colspan="8">Belum ada barang. Fokuskan BARCODE lalu scan/ketik barang.</td></tr>`;
        return;
      }

      tbody.innerHTML = cart.map((item,index) => {
        const itemTotal = Number(item.qty||0) * Number(item.currentPrice||0);
        const active = index === activeCartRowIndex;
        const mode = item.priceMode === 'grosir' ? 'grosir' : 'eceran';
        return `
          <tr data-cart-index="${index}" data-product-id="${item.id}" class="${active ? 'active-cart-row' : ''}" onclick="setActiveCartRow(${index}, false)">
            <td class="text-center font-bold">${index + 1}</td>
            <td>
              <input class="classic-cell-input" value="${item.barcode || item.kode || ''}"
                readonly tabindex="-1" aria-label="Barcode ${item.nama}">
            </td>
            <td title="${item.nama}">
              <input class="classic-cell-input" value="${String(item.nama).replace(/"/g,'&quot;')}"
                readonly tabindex="-1" aria-label="Nama ${item.nama}">
            </td>
            <td>
              <button type="button" class="classic-price-toggle ${mode === 'grosir' ? 'grosir' : ''}"
                onclick="event.stopPropagation(); togglePriceMode('${item.id}','${mode === 'grosir' ? 'eceran' : 'grosir'}')">
                ${mode === 'grosir' ? 'GROSIR' : 'ECER'}
              </button>
            </td>
            <td class="text-right font-bold">Rp${Number(item.currentPrice||0).toLocaleString('id-ID')}</td>
            <td>
              <input id="cart-qty-${item.id}" data-qty-input="true" type="number" min="1" max="${item.stok || 1}" step="1"
                value="${item.qty}" inputmode="numeric" autocomplete="off"
                class="classic-cell-input classic-qty-input"
                onfocus="activeCartItemId='${item.id}'; activeCartRowIndex=${index}; syncActiveCartRow(); this.select()"
                oninput="updateCartQtyFromInput('${item.id}',this)"
                onblur="normalizeCartQtyInput('${item.id}',this)"
                onkeydown="handleCartQtyKeydown(event,'${item.id}')">
            </td>
            <td class="text-right font-bold">Rp${itemTotal.toLocaleString('id-ID')}</td>
            <td class="classic-delete-cell">
              <button type="button" onclick="event.stopPropagation(); removeCartItem('${item.id}'); focusKasirSearch()" title="Hapus">DEL</button>
            </td>
          </tr>
        `;
      }).join('');

      syncActiveCartRow();
    }

    function switchBarangSubTab(tab) {
      activeBarangSubTab = tab;
      const vKatalog = document.getElementById('subview-katalog-barang');
      const vMutasi = document.getElementById('subview-mutasi-stok');
      const btnKatalog = document.getElementById('tab-sub-barang');
      const btnMutasi = document.getElementById('tab-sub-stok');

      if (tab === 'katalog') {
        vKatalog.style.display = 'block';
        vMutasi.style.display = 'none';
        btnKatalog.className = 'pb-2 text-emerald-600 border-b-2 border-emerald-600 flex items-center space-x-1.5 font-bold';
        btnMutasi.className = 'pb-2 text-gray-400 hover:text-gray-600 flex items-center space-x-1.5 font-semibold';
      } else {
        vKatalog.style.display = 'none';
        vMutasi.style.display = 'block';
        btnMutasi.className = 'pb-2 text-emerald-600 border-b-2 border-emerald-600 flex items-center space-x-1.5 font-bold';
        btnKatalog.className = 'pb-2 text-gray-400 hover:text-gray-600 flex items-center space-x-1.5 font-semibold';
      }
      lucide.createIcons();
    }

    function renderProductsTable() {
      const tbody = document.getElementById('table-barang-body');
      const search = (document.getElementById('filter-barang-search')?.value || '').toLowerCase();
      const kat = document.getElementById('filter-barang-kategori')?.value || 'semua';
      const isAdmin = currentUser && currentUser.role === 'admin';

      let filtered = products.filter(p => {
        const matchSearch = p.nama.toLowerCase().includes(search) || p.kode.toLowerCase().includes(search) || (p.barcode && p.barcode.includes(search));
        const matchKat = kat === 'semua' || p.kategori === kat;
        const matchMenipis = !filterMenipisOnly || p.stok <= 5;
        return matchSearch && matchKat && matchMenipis;
      });

      document.getElementById('barang-count-label').innerText = `${products.length} barang terdaftar di sistem`;

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="px-4 py-8 text-center text-gray-400">Tidak ada barang yang cocok</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(p => {
        const isChecked = selectedProductIds.has(p.id);
        const grosirPrice = p.hGrosir || Math.round(p.hJual * 0.9);
        return `
          <tr class="hover:bg-gray-50/60 transition ${isChecked ? 'bg-emerald-50/40' : ''}">
            ${isAdmin ? `
              <td class="px-4 py-3 text-center">
                <input type="checkbox" onchange="toggleSelectProduct('${p.id}', this)" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
              </td>
            ` : ''}
            <td class="px-4 py-3 font-semibold text-gray-900">${escapeHtml(p.kode)}</td>
            <td class="catalog-barcode px-4 py-3 font-mono text-gray-500 text-[11px]">${escapeHtml(p.barcode || '-')}</td>
            <td class="catalog-name px-5 py-3 font-semibold text-gray-900">${escapeHtml(p.nama)}</td>
            <td class="catalog-category px-4 py-3 text-gray-500">${escapeHtml(p.kategori)}</td>
            ${isAdmin ? `
              <td class="catalog-price px-4 py-3 font-medium text-gray-700">
                Rp${(p.hModal || 0).toLocaleString('id-ID')}
              </td>
            ` : ''}
            <td class="catalog-price px-4 py-3 font-bold text-gray-900">Rp${(p.hJual || 0).toLocaleString('id-ID')}</td>
            <td class="catalog-price px-4 py-3 font-bold text-emerald-700">Rp${grosirPrice.toLocaleString('id-ID')}</td>
            <td class="catalog-stock px-4 py-3 text-center font-extrabold ${Number(p.stok || 0) <= 5 ? 'text-rose-600' : 'text-indigo-700'}">${Number(p.stok || 0).toLocaleString('id-ID')} ${Number(p.stok || 0) <= 5 ? '<span class="text-[10px]">(Menipis)</span>' : ''}</td>
            ${isAdmin ? `
              <td class="catalog-actions px-3 py-3">
                <button onclick="openModalStok('tambah', '${p.id}')" title="Tambah Stok Barang" class="btn-stock-add"><i data-lucide="plus-circle" class="w-4 h-4"></i><span>Tambah</span></button>
                <button onclick="openModalStok('kurang', '${p.id}')" title="Kurangi Stok Barang" class="btn-stock-minus"><i data-lucide="minus-circle" class="w-4 h-4"></i><span>Kurangi</span></button>
                <button onclick="showBarcodeModal('${p.id}')" title="Cetak Barcode" class="btn-barcode-product" aria-label="Cetak barcode"><i data-lucide="barcode" class="w-4 h-4"></i></button>
                <button onclick="openModalBarang('${p.id}')" title="Edit Barang" class="btn-edit-product" aria-label="Edit barang"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button onclick="deleteProduct('${p.id}')" title="Hapus Barang" aria-label="Hapus barang" class="btn-delete-product"><i data-lucide="trash-2" class="w-4 h-4"></i><span>Hapus</span></button>
              </td>
            ` : ''}
          </tr>
        `;
      }).join('');
      lucide.createIcons();
      updateBulkDeleteUI();
    }

    function setupUserInterface() {
      const isAdmin = currentUser.role === 'admin';
      document.getElementById('user-name').innerText = currentUser.name;
      
      const b = document.getElementById('user-badge');
      b.innerText = currentUser.badge;
      b.className = `inline-block px-1.5 py-0.5 text-[9px] font-bold rounded uppercase mt-0.5 tracking-wider ${currentUser.badgeColor}`;

      const mb = document.getElementById('mobile-user-badge');
      if (mb) {
        mb.innerText = currentUser.badge;
        mb.className = `text-[10px] font-bold px-2 py-0.5 rounded uppercase ${currentUser.badgeColor}`;
      }

      document.getElementById('user-avatar').innerText = isAdmin ? 'OA' : 'KU';
      document.getElementById('settings-user-info').innerText = `${currentUser.name} · @${currentUser.username}`;
      document.getElementById('settings-user-role').innerText = currentUser.role;

      initializeDateFilters();
      const today = getTodayISODate();
      if (document.getElementById('laporan-period')) document.getElementById('laporan-period').value = today.slice(0, 7);

      document.querySelectorAll('.admin-only').forEach(el => {
        if (el.id === 'subview-mutasi-stok') return;
        if (isAdmin) el.classList.remove('hidden');
        else el.classList.add('hidden');
      });

      switchBarangSubTab('katalog');

      renderDashboard();
      renderKasirCategoryPills();
      renderKasirCatalog();
      renderKasirMemberDropdown();
      renderProductsTable();
      renderMemberTable();
      renderStokTable();
      renderTransaksiTable();
      renderReturTable();
      renderKasTable();
      renderBriLinkTable();
      renderUsersTable();
      renderAktivitas();
      renderLaporan();
    }

    function showReceiptModal(tx) {
      lastActiveTxForReceipt = tx;
      document.getElementById('rcpt-no').innerText = tx.id;
      document.getElementById('rcpt-date').innerText = tx.waktu;
      document.getElementById('rcpt-cashier').innerText = tx.kasir;
      document.getElementById('rcpt-customer').innerText = tx.customerName || 'Umum';
      document.getElementById('rcpt-method').innerText = tx.metode || 'CASH';
      document.getElementById('rcpt-total').innerText = 'Rp' + tx.total.toLocaleString('id-ID');
      document.getElementById('rcpt-paid').innerText = 'Rp' + (tx.bayar || tx.total).toLocaleString('id-ID');
      document.getElementById('rcpt-change').innerText = 'Rp' + (tx.kembali || 0).toLocaleString('id-ID');

      const itemsContainer = document.getElementById('rcpt-items');
      itemsContainer.innerHTML = (tx.items || []).map(item => {
        const price = item.currentPrice || item.harga || item.hJual;
        const modeLabel = item.priceMode === 'grosir' ? '(G)' : '';
        return `
          <div class="flex justify-between items-start text-[10px]">
            <span class="truncate max-w-[140px]">${escapeHtml(item.nama)} ${escapeHtml(modeLabel)}</span>
            <span class="shrink-0 text-right">${item.qty} x Rp${price.toLocaleString('id-ID')}</span>
          </div>
        `;
      }).join('');

      openModal('modal-receipt');
      lucide.createIcons();
    }

    function openPromptWaModal() {
      if (!lastActiveTxForReceipt) return;
      const tx = lastActiveTxForReceipt;
      if (tx.customerPhone && tx.customerPhone.trim().length >= 6) {
        eksekusiKirimWhatsApp(tx.customerPhone);
      } else {
        document.getElementById('input-manual-wa').value = '';
        openModal('modal-prompt-wa');
        setTimeout(() => document.getElementById('input-manual-wa').focus(), 150);
      }
    }

    function submitManualWaAndSend() {
      const phoneInput = document.getElementById('input-manual-wa').value.trim();
      if (!phoneInput) {
        alert('Harap masukkan nomor WhatsApp pelanggan!');
        return;
      }
      document.getElementById('input-manual-wa').value = '';
      closeModal('modal-prompt-wa');
      eksekusiKirimWhatsApp(phoneInput);
    }

    function eksekusiKirimWhatsApp(phoneNumber) {
      if (!lastActiveTxForReceipt) return;
      const tx = lastActiveTxForReceipt;

      let targetPhone = phoneNumber.replace(/\D/g, '');
      if (targetPhone.startsWith('0')) targetPhone = '62' + targetPhone.substring(1);
      if (targetPhone.startsWith('8')) targetPhone = '62' + targetPhone;

      let rincianBarang = (tx.items || []).map((it, idx) => {
        const p = it.currentPrice || it.harga || it.hJual;
        return `   ${idx + 1}. ${it.nama} (${it.qty}x) = Rp${(it.qty * p).toLocaleString('id-ID')}`;
      }).join('\n');

      const pesan = `*TOKO BUNG EDI*\nJalan Turonggo Karangturi\nWhatsApp: 0851327958234\n--------------------------------\n*STRUK PEMBAYARAN RESMI*\nNo Transaksi : ${tx.id}\nWaktu        : ${tx.waktu}\nKasir        : ${tx.kasir}\nPelanggan    : ${tx.customerName || 'Umum'}\nMetode       : ${tx.metode}\n--------------------------------\n*DETAIL PEMBELIAN:*\n${rincianBarang}\n--------------------------------\n*TOTAL TAGIHAN : Rp${tx.total.toLocaleString('id-ID')}*\nBayar         : Rp${(tx.bayar || tx.total).toLocaleString('id-ID')}\nKembalian     : Rp${(tx.kembali || 0).toLocaleString('id-ID')}\n--------------------------------\nTerima kasih telah berbelanja di Toko Bung Edi!`;

      const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(pesan)}`;
      window.open(waUrl, '_blank');
      showToast('Membuka WhatsApp...');
    }

    function handleCheckoutKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeModal('modal-checkout');
        focusKasirSearch();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        confirmCheckout();
        return;
      }
    }

    function openCheckoutModal() {
      if (cart.length === 0) {
        alert('Keranjang belanja masih kosong!');
        return;
      }
      const total = cart.reduce((s, i) => s + (i.qty * i.currentPrice), 0);
      document.getElementById('checkout-total-bill').innerText = 'Rp' + total.toLocaleString('id-ID');

      const bayarInput = document.getElementById('checkout-bayar');
      bayarInput.value = 0;
      hitungKembalian();
      updatePaymentMethodUI();

      openModal('modal-checkout');
      setTimeout(() => bayarInput.focus(), 150);
    }

    function setNominalPas() {
      const total = cart.reduce((s, i) => s + (i.qty * i.currentPrice), 0);
      document.getElementById('checkout-bayar').value = total;
      hitungKembalian();
    }

    function quickAddBayar(val) {
      const curr = parseInt(document.getElementById('checkout-bayar').value) || 0;
      document.getElementById('checkout-bayar').value = curr + val;
      hitungKembalian();
    }

    function updatePaymentMethodUI() {
      const metode = String(document.getElementById('checkout-metode')?.value || 'CASH').toUpperCase();
      const label = document.getElementById('checkout-bayar-label');
      const input = document.getElementById('checkout-bayar');
      const quick = document.getElementById('checkout-quick-pay');
      const total = cart.reduce((s, i) => s + (Number(i.qty) * Number(i.currentPrice)), 0);
      const nonCash = metode !== 'CASH';
      if (label) label.innerText = nonCash ? 'Nominal Pembayaran' : 'Uang Diterima (Nominal Bayar)';
      if (input) {
        input.readOnly = nonCash;
        input.value = nonCash ? total : (input.value || '');
        input.classList.toggle('bg-gray-100', nonCash);
      }
      if (quick) quick.classList.toggle('hidden', nonCash);
      const k = document.getElementById('checkout-kembalian');
      if (k) k.innerText = 'Rp0';
    }

    function hitungKembalian() {
      const total = cart.reduce((s, i) => s + (Number(i.qty) * Number(i.currentPrice)), 0);
      const metode = String(document.getElementById('checkout-metode')?.value || 'CASH').toUpperCase();
      const bayar = metode === 'CASH' ? (parseInt(document.getElementById('checkout-bayar')?.value, 10) || 0) : total;
      const kembalian = Math.max(0, bayar - total);
      document.getElementById('checkout-kembalian').innerText = 'Rp' + kembalian.toLocaleString('id-ID');
    }

    async function confirmCheckout() {
      // Checkout KASIR sepenuhnya lokal. Tidak ada callable, Firestore,
      // fallback cloud, atau listener Firebase yang dipanggil di sini.
      if (checkoutInProgress) return;
      if (!cart.length) { alert('Keranjang belanja masih kosong!'); return; }

      const metode = String(document.getElementById('checkout-metode')?.value || 'CASH').toUpperCase();
      const total = cart.reduce((s, i) => s + (Number(i.qty) * Number(i.currentPrice)), 0);
      const bayarInput = parseInt(document.getElementById('checkout-bayar')?.value, 10) || 0;
      const bayar = metode === 'CASH' ? bayarInput : total;
      if (!Number.isFinite(total) || total <= 0) { alert('Total transaksi tidak valid.'); return; }
      if (bayar < total) { alert('Nominal pembayaran masih kurang dari total belanja!'); return; }

      checkoutInProgress = true;
      const btn = document.getElementById('btn-confirm-checkout');
      const oldBtnText = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = 'Memproses...'; }

      // Snapshot untuk rollback jika penyimpanan lokal gagal.
      const backup = {
        products: cloneJson(products), members: cloneJson(members), transactions: cloneJson(transactions),
        stokLogs: cloneJson(stokLogs), counters: cloneJson(localCounters)
      };

      try {
        const now = new Date();
        const dateKey = getLocalDateKey(now);
        const timeStr = now.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) + ' WIB';
        const txSeq = nextLocalNumber('transactions', dateKey);
        const txNumber = `TRX-${dateKey.replace(/-/g, '')}-${String(txSeq).padStart(4, '0')}`;
        const memberId = document.getElementById('kasir-member-select')?.value || '';

        // 1) VALIDASI SEMUA BARANG DULU. Tidak ada state yang diubah sebelum seluruh keranjang valid.
        const seen = new Set();
        const prepared = [];
        let totalModal = 0;
        for (const item of cart) {
          const id = String(item.id);
          if (seen.has(id)) throw new Error(`Item ${id} muncul lebih dari sekali di keranjang.`);
          seen.add(id);
          const prod = products.find(p => String(p.id) === id);
          if (!prod) throw new Error(`Produk ${id} tidak ditemukan.`);
          const qty = Math.floor(Number(item.qty));
          if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Jumlah ${prod.nama} tidak valid.`);
          const stok = Number(prod.stok) || 0;
          if (stok < qty) throw new Error(`Stok ${prod.nama} tidak mencukupi. Stok tersedia: ${stok}.`);
          const priceMode = item.priceMode === 'grosir' ? 'grosir' : 'eceran';
          const unitPrice = Math.round(Number(item.currentPrice) || Number(priceMode === 'grosir' ? prod.hGrosir : prod.hJual) || 0);
          if (unitPrice <= 0) throw new Error(`Harga ${prod.nama} tidak valid.`);
          const modal = Math.max(0, Number(prod.hModal) || 0);
          prepared.push({ item, prod, qty, stok, unitPrice, modal, subtotal: qty * unitPrice });
          totalModal += qty * modal;
        }
        const calculatedTotal = prepared.reduce((sum, x) => sum + x.subtotal, 0);
        if (calculatedTotal !== total) throw new Error('Total keranjang berubah. Silakan ulangi pembayaran.');

        let custName = 'Umum';
        let custPhone = '';
        let memberSnapshot = null;
        if (memberId) {
          memberSnapshot = members.find(m => String(m.id) === String(memberId));
          if (memberSnapshot) {
            custName = memberSnapshot.nama || 'Umum';
            custPhone = memberSnapshot.phone || '';
          }
        }

        // 2) COMMIT DI MEMORI — semua perubahan dibuat setelah validasi selesai.
        const stockLogsToAdd = [];
        prepared.forEach(({ item, prod, qty, stok, unitPrice, modal }) => {
          const setelah = stok - qty;
          prod.stok = setelah;
          stockLogsToAdd.push({
            id: makeOperationId('STK-SALE'), timestamp: Date.now(), dateKey, waktu: timeStr,
            barang: prod.nama, barangId: prod.id, tipe: 'SALE', qty: -qty,
            sebelum: stok, setelah, user: currentUser?.name || 'User', username: currentUser?.username || ''
          });
        });
        stokLogs.unshift(...stockLogsToAdd);
        if (memberSnapshot) memberSnapshot.poin = (Number(memberSnapshot.poin) || 0) + Math.floor(total / 10000);

        const finalItems = prepared.map(({ item, prod, qty, unitPrice }) => ({
          id: String(prod.id), kode: String(prod.kode || ''), barcode: String(prod.barcode || ''),
          nama: String(prod.nama || ''), kategori: String(prod.kategori || ''),
          hModal: Number(prod.hModal) || 0, hJual: Number(prod.hJual) || 0, hGrosir: Number(prod.hGrosir) || 0,
          qty, priceMode: item.priceMode === 'grosir' ? 'grosir' : 'eceran', currentPrice: unitPrice
        }));
        const newTx = {
          id: txNumber, timestamp: Date.now(), createdAt: null, dateKey, waktu: timeStr,
          kasir: currentUser?.name || 'User', kasirUsername: currentUser?.username || '',
          customerName: custName, customerPhone: custPhone, memberId: memberId || '', metode,
          bayar, kembali: Math.max(0, bayar - total), total, profit: total - totalModal,
          status: 'SUKSES', items: finalItems, localOnly: true
        };
        transactions.unshift(newTx);

        // 3) SIMPAN SNAPSHOT LENGKAP. Jika IndexedDB gagal, seluruh perubahan dikembalikan.
        await persistLocalState();

        addLog('SALE', `Transaksi kasir ${txNumber} Rp${total.toLocaleString('id-ID')}`);
        await persistLocalState();
        closeModal('modal-checkout');
        clearCart();
        document.getElementById('form-checkout')?.reset();
        document.getElementById('checkout-bayar').value = metode === 'CASH' ? '' : total;
        document.getElementById('checkout-kembalian').innerText = 'Rp0';
        renderTransaksiTable(); renderDashboard(); renderLaporan(); renderKasTable(); renderStokTable(); renderKasirCatalog(); renderKasirMemberDropdown();
        showReceiptModal(newTx);
        showToast('Transaksi berhasil. Struk siap dicetak.');
        setTimeout(() => document.getElementById('thermal-receipt')?.focus(), 100);
        // Coba buka dialog printer otomatis; jika browser memblokir, tombol Cetak Thermal tetap siap.
        setTimeout(() => printReceiptAutomatically(), 450);
      } catch (err) {
        products = backup.products; members = backup.members; transactions = backup.transactions; stokLogs = backup.stokLogs; localCounters = backup.counters;
        scheduleLocalPersist(50);
        console.error('Checkout lokal gagal:', err);
        showToast(err?.message || 'Transaksi gagal diproses. Tidak ada perubahan yang disimpan.');
      } finally {
        checkoutInProgress = false;
        if (btn) { btn.disabled = false; btn.innerHTML = oldBtnText || 'ENTER — BAYAR & BUKA STRUK'; }
      }
    }

    function openModalBarangSimple() {
      const form = document.getElementById('form-barang-simple');
      form.reset();
      generateRandomBarcodeSimple();
      openModal('modal-barang-simple');
      setupEnterStepNavigation();
      setTimeout(() => document.getElementById('simple-nama').focus(), 150);
    }

    function generateRandomBarcodeSimple() {
      const prefix = '899' + Math.floor(1000000000 + Math.random() * 9000000000);
      document.getElementById('simple-barcode').value = prefix;
    }

    async function saveProductSimple(e) {
      e.preventDefault();
      const nama = document.getElementById('simple-nama').value.trim();
      let barcode = document.getElementById('simple-barcode').value.trim();
      const hModal = parseInt(document.getElementById('simple-modal').value) || 0;
      const hJual = parseInt(document.getElementById('simple-jual').value) || 0;
      let hGrosir = parseInt(document.getElementById('simple-grosir').value);
      if (!hGrosir || isNaN(hGrosir)) hGrosir = Math.round(hJual * 0.9);
      const stok = parseInt(document.getElementById('simple-stok').value) || 0;
      const id = String(Date.now());
      const kode = 'P' + String(products.length + 1).padStart(3, '0');

      if (!barcode) barcode = '899' + Math.floor(1000000000 + Math.random() * 9000000000);

      const prodData = { id, kode, barcode, nama, kategori: 'Umum', hModal, hJual, hGrosir, stok };

      if (!isFirebaseReady) products.push(prodData);
      else await syncToCloud("products", id, prodData);

      addLog('QUICK_ADD_PRODUCT', `Barang kilat ${nama} ditambahkan`);
      clearExecutedForm('form-barang-simple');
      closeModal('modal-barang-simple');
      renderProductsTable();
      renderPopupBarangList();
      showToast(`Barang "${nama}" berhasil disimpan.`);
    }

    function openModalBarang(editId = null) {
      const form = document.getElementById('form-barang');
      form.reset();
      if (editId) {
        const prod = products.find(p => String(p.id) === String(editId));
        document.getElementById('modal-barang-title').innerText = 'Edit Barang';
        document.getElementById('barang-id').value = prod.id;
        document.getElementById('barang-kode').value = prod.kode;
        document.getElementById('barang-barcode').value = prod.barcode || '';
        document.getElementById('barang-nama').value = prod.nama;
        document.getElementById('barang-kategori').value = prod.kategori;
        document.getElementById('barang-modal').value = prod.hModal;
        document.getElementById('barang-jual').value = prod.hJual;
        document.getElementById('barang-grosir').value = prod.hGrosir || Math.round(prod.hJual * 0.9);
        document.getElementById('barang-stok').value = prod.stok;
      } else {
        document.getElementById('modal-barang-title').innerText = 'Tambah Barang Baru';
        document.getElementById('barang-id').value = '';
        document.getElementById('barang-kode').value = 'P' + String(products.length + 1).padStart(3, '0');
        generateRandomBarcode();
      }
      openModal('modal-barang');
      setupEnterStepNavigation();
      setTimeout(() => document.getElementById('barang-nama').focus(), 150);
    }

    async function addProductCategory() {
      const select = document.getElementById('barang-kategori');
      const name = prompt('Masukkan nama kategori baru:');
      if (name === null) return;
      const kategori = name.trim().replace(/\s+/g, ' ');
      if (!kategori) return showToast('Nama kategori tidak boleh kosong', 'error');
      const exists = Array.from(select.options).some(o => o.value.toLowerCase() === kategori.toLowerCase());
      if (exists) { select.value = Array.from(select.options).find(o => o.value.toLowerCase() === kategori.toLowerCase()).value; return showToast('Kategori sudah tersedia'); }
      const option = new Option(kategori, kategori);
      select.add(option);
      select.value = kategori;
      try {
        if (isFirebaseReady && db) await db.collection('categories').doc(kategori.toLowerCase().replace(/[^a-z0-9]+/g, '-')).set({ nama: kategori, dibuat: new Date().toISOString() }, { merge: true });
        showToast(`Kategori "${kategori}" berhasil ditambahkan${isFirebaseReady ? ' ke Cloud' : ''}`);
      } catch (err) {
        console.error('Gagal menyimpan kategori:', err);
        showToast('Kategori ditambahkan sementara, tetapi gagal disimpan ke Cloud', 'error');
      }
    }

    async function refreshProductCategories() {
      const selects = [document.getElementById('barang-kategori'), document.getElementById('filter-barang-kategori')].filter(Boolean);
      const names = new Set();
      products.forEach(p => { if (p.kategori && String(p.kategori).trim()) names.add(String(p.kategori).trim()); });
      if (isFirebaseReady && db) {
        try { const snap = await db.collection('categories').get(); snap.forEach(d => { const n=d.data().nama || d.id; if(n) names.add(String(n).trim()); }); } catch(e) { console.warn('Kategori cloud tidak terbaca',e); }
      }
      selects.forEach((select, idx) => {
        const current = select.value;
        select.innerHTML = idx === 1 ? '<option value="semua">Semua Kategori</option>' : '<option value="">Pilih kategori</option>';
        [...names].sort((a,b)=>a.localeCompare(b,'id')).forEach(n => select.add(new Option(n,n)));
        if ([...select.options].some(o=>o.value===current)) select.value=current;
      });
    }

    async function deleteProductCategory() {
      const select = document.getElementById('barang-kategori');
      const kategori = select?.value?.trim();
      if (!kategori) return showToast('Pilih kategori yang ingin dihapus', 'error');
      const dipakai = products.some(p => String(p.kategori || '').toLowerCase() === kategori.toLowerCase());
      if (dipakai) return showToast('Kategori masih digunakan oleh barang dan tidak dapat dihapus', 'error');
      if (!confirm(`Hapus kategori "${kategori}"?`)) return;
      try {
        if (isFirebaseReady && db) await db.collection('categories').doc(kategori.toLowerCase().replace(/[^a-z0-9]+/g,'-')).delete();
        await refreshProductCategories();
        select.value = '';
        showToast(`Kategori "${kategori}" berhasil dihapus`);
      } catch (err) { console.error(err); showToast('Gagal menghapus kategori dari Cloud','error'); }
    }

    async function saveProduct(e) {
      e.preventDefault();
      const id = document.getElementById('barang-id').value || String(Date.now());
      const kode = document.getElementById('barang-kode').value.trim();
      const barcode = document.getElementById('barang-barcode').value.trim() || kode;
      const nama = document.getElementById('barang-nama').value.trim();
      const kategori = document.getElementById('barang-kategori').value;
      const hModal = parseInt(document.getElementById('barang-modal').value) || 0;
      const hJual = parseInt(document.getElementById('barang-jual').value) || 0;
      const hGrosir = parseInt(document.getElementById('barang-grosir').value) || 0;
      const stok = parseInt(document.getElementById('barang-stok').value) || 0;

      const prodData = { id, kode, barcode, nama, kategori, hModal, hJual, hGrosir, stok };

      if (!isFirebaseReady) {
        const idx = products.findIndex(p => String(p.id) === String(id));
        if (idx >= 0) products[idx] = prodData;
        else products.push(prodData);
      } else {
        await syncToCloud("products", id, prodData);
      }

      addLog('SAVE_PRODUCT', `Barang ${nama} (${kode}) disimpan`);
      clearExecutedForm('form-barang');
      closeModal('modal-barang');
      renderProductsTable();
      renderPopupBarangList();
      showToast(isFirebaseReady ? 'Barang berhasil disimpan di Cloud.' : 'Barang berhasil disimpan di perangkat.');
    }

    function openModalMember(editId = null) {
      const form = document.getElementById('form-member');
      form.reset();
      if (editId) {
        const mem = members.find(m => m.id === editId);
        document.getElementById('modal-member-title').innerText = 'Edit Member';
        document.getElementById('member-id').value = mem.id;
        document.getElementById('member-nama').value = mem.nama;
        document.getElementById('member-phone').value = mem.phone;
        document.getElementById('member-alamat').value = mem.alamat || '';
      } else {
        document.getElementById('modal-member-title').innerText = 'Tambah Member Baru';
        document.getElementById('member-id').value = 'M' + String(members.length + 1).padStart(3, '0');
      }
      openModal('modal-member');
    }

    async function saveMember(e) {
      e.preventDefault();
      const id = document.getElementById('member-id').value || 'M' + Date.now();
      const nama = document.getElementById('member-nama').value.trim();
      let phone = document.getElementById('member-phone').value.trim();
      const alamat = document.getElementById('member-alamat').value.trim();

      if (phone.startsWith('0')) phone = '62' + phone.substring(1);
      if (phone.startsWith('+62')) phone = phone.substring(1);

      const memData = { id, nama, phone, alamat, poin: 0 };

      if (!isFirebaseReady) {
        const idx = members.findIndex(m => m.id === id);
        if (idx >= 0) members[idx] = memData;
        else members.push(memData);
      } else {
        await syncToCloud("members", id, memData);
      }

      addLog('SAVE_MEMBER', `Member: ${nama} (${phone}) tersimpan`);
      clearExecutedForm('form-member');
      closeModal('modal-member');
      renderMemberTable();
      renderKasirMemberDropdown();
      showToast(isFirebaseReady ? 'Data member tersimpan di Cloud Firestore!' : 'Data member tersimpan di perangkat.');
    }

    async function deleteMember(id) {
      if (!confirm('Hapus member ini dari database cloud?')) return;
      if (!isFirebaseReady) {
        members = members.filter(m => m.id !== id);
      } else {
        await deleteFromCloud("members", id);
      }
      renderMemberTable();
      renderKasirMemberDropdown();
      showToast('Member dihapus');
    }

    function renderMemberTable() {
      const tbody = document.getElementById('table-member-body');
      const search = (document.getElementById('filter-member-search')?.value || '').toLowerCase();
      const filtered = members.filter(m => m.nama.toLowerCase().includes(search) || m.phone.includes(search));

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Belum ada data member</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(m => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900">${escapeHtml(m.id)}</td>
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-800">${escapeHtml(m.nama)}</td>
          <td class="px-4 sm:px-6 py-3 text-emerald-700 font-semibold font-mono">${escapeHtml(m.phone)}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">${escapeHtml(m.alamat || '-')}</td>
          <td class="px-4 sm:px-6 py-3 font-extrabold text-emerald-700">${m.poin || 0} pts</td>
          <td class="px-4 sm:px-6 py-3 text-right space-x-1">
            <button onclick="openModalMember('${escapeHtml(m.id)}')" class="p-1 text-gray-400 hover:text-emerald-600"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button onclick="deleteMember('${escapeHtml(m.id)}')" class="p-1 text-gray-400 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    function renderKasirMemberDropdown() {
      const select = document.getElementById('kasir-member-select');
      if (!select) return;
      let opts = '<option value="">Non Member (Pelanggan Biasa)</option>';
      members.forEach(m => {
        opts += `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nama)} (${escapeHtml(m.phone)})</option>`;
      });
      select.innerHTML = opts;
    }

    function openModalKas(type) {
      document.getElementById('kas-type').value = type;
      const targetContainer = document.getElementById('kas-target-container');
      const submitBtn = document.getElementById('btn-submit-kas');

      if (type === 'pemasukan') {
        document.getElementById('modal-kas-title').innerText = 'Catat Pemasukan Manual';
        targetContainer.classList.add('hidden');
        submitBtn.className = 'px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold';
      } else {
        document.getElementById('modal-kas-title').innerText = 'Catat Pengeluaran';
        targetContainer.classList.remove('hidden');
        document.getElementById('target-toko').checked = true;
        submitBtn.className = 'px-4 py-2 bg-red-600 text-white rounded-xl font-bold';
      }
      openModal('modal-kas');
    }

    function openModalKasSpecific(type, target) {
      openModalKas(type);
      if (type === 'pengeluaran') {
        if (target === 'brilink') {
          document.getElementById('target-brilink').checked = true;
          document.getElementById('kas-kategori').placeholder = 'Contoh: Biaya Admin Bank / Pulsa Struk / Sewa EDC';
        } else {
          document.getElementById('target-toko').checked = true;
          document.getElementById('kas-kategori').placeholder = 'Contoh: Kulakan Sembako / Listrik / Gaji';
        }
      }
    }

    function switchPengeluaranTab(tab) {
      activePengeluaranTab = tab;
      document.querySelectorAll('.exp-tab').forEach(btn => {
        btn.className = 'exp-tab text-gray-400 pb-2 hover:text-gray-700 font-semibold';
      });
      const activeBtn = document.getElementById(`tab-exp-${tab}`);
      if (activeBtn) activeBtn.className = 'exp-tab text-emerald-700 border-b-2 border-emerald-600 pb-2 font-bold';
      renderKasTable();
    }

    async function saveKas(e) {
      e.preventDefault();

      const type = document.getElementById('kas-type').value;
      const kategori = document.getElementById('kas-kategori').value.trim();
      const metode = document.getElementById('kas-metode').value;
      const nominal = parseInt(document.getElementById('kas-nominal').value, 10) || 0;
      const catatan = document.getElementById('kas-catatan').value.trim();

      if (nominal <= 0) {
        showToast('Nominal harus lebih dari 0');
        return;
      }

      const now = new Date();
      const dateKey = getLocalDateKey(now);
      const timeStr = now.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';

      if (type === 'pemasukan') {
        const entry = {
          id: 'IN-' + Date.now(),
          dateKey,
          tanggal: timeStr,
          kategori,
          metode,
          nominal,
          catatan,
          source: 'manual'
        };

        pemasukans.unshift(entry);
        await syncToCloud("pemasukans", entry.id, entry);
        addLog('CASH_IN', `Pemasukan manual Rp${nominal.toLocaleString('id-ID')}`);
      } else {
        // Baca pilihan radio secara eksplisit dari elemen yang diklik.
        // Ini mencegah pilihan BRI Link jatuh kembali ke "toko".
        const radioBrilink = document.getElementById('target-brilink');
        const radioToko = document.getElementById('target-toko');
        const expenseType = radioBrilink && radioBrilink.checked
          ? 'brilink'
          : (radioToko && radioToko.checked ? 'toko' : 'toko');

        const entry = {
          id: (expenseType === 'brilink' ? 'EXP-BRI-' : 'EXP-TOK-') + Date.now(),
          expenseType,
          jenisPengeluaran: expenseType,
          dateKey,
          tanggal: timeStr,
          kategori,
          metode,
          nominal,
          catatan,
          source: 'manual'
        };

        pengeluarans.unshift(entry);
        await syncToCloud("pengeluarans", entry.id, entry);

        addLog(
          'CASH_OUT',
          `Pengeluaran [${expenseType.toUpperCase()}] ${kategori} Rp${nominal.toLocaleString('id-ID')}`
        );
      }

      renderKasTable();
      renderDashboard();
      renderLaporan();
      clearExecutedForm('form-kas');
      // Setelah reset, pastikan default kembali ke Toko untuk input berikutnya.
      const targetToko = document.getElementById('target-toko');
      const targetBri = document.getElementById('target-brilink');
      if (targetToko) targetToko.checked = true;
      if (targetBri) targetBri.checked = false;

      closeModal('modal-kas');
      showToast(isFirebaseReady ? 'Data berhasil disimpan & terintegrasi ke pembukuan.' : 'Data berhasil disimpan di perangkat.');
    }

    async function deleteKas(type, id) {
      if (!confirm(`Hapus data ${type} ini?`)) return;
      if (!isFirebaseReady) {
        if (type === 'pemasukan') pemasukans = pemasukans.filter(p => p.id !== id);
        else pengeluarans = pengeluarans.filter(p => p.id !== id);
      } else {
        await deleteFromCloud(type === 'pemasukan' ? "pemasukans" : "pengeluarans", id);
      }
      renderKasTable();
      renderDashboard();
      renderLaporan();
      showToast(`Data ${type} dihapus`);
    }

    function getIntegratedPemasukanList() {
      const list = [...pemasukans];

      transactions.filter(t => t.status === 'SUKSES').forEach(t => {
        list.push({
          id: t.id,
          dateKey: t.dateKey,
          tanggal: t.waktu,
          kategori: 'Penjualan Kasir',
          metode: t.metode,
          nominal: t.total,
          catatan: `Pelanggan: ${escapeHtml(t.customerName || 'Umum')}`,
          isSystem: true
        });
      });

      brilinks.forEach(b => {
        list.push({
          id: b.id,
          dateKey: b.dateKey,
          tanggal: b.waktu,
          kategori: `BRI Link (${b.jenis})`,
          metode: 'SISTEM',
          nominal: b.profit,
          catatan: `Fee profit agen ${b.id}`,
          isSystem: true
        });
      });

      return list;
    }

    function getPeriodFilter(prefix) {
      return { date: document.getElementById(`filter-${prefix}-date`)?.value || getTodayISODate() };
    }

    function matchesPeriod(item, prefix) {
      return getItemDateKey(item) === getPeriodFilter(prefix).date;
    }

    function clearKasFilters() {
      const today = getTodayISODate();
      ['pemasukan','pengeluaran','brilink'].forEach(prefix => {
        const el = document.getElementById(`filter-${prefix}-date`);
        if (el) el.value = today;
      });
      renderKasTable();
      renderBriLinkTable();
    }

    function setTodayForFilter(prefix) {
      const el = document.getElementById(`filter-${prefix}-date`);
      if (el) el.value = getTodayISODate();
      if (prefix === 'brilink') renderBriLinkTable();
      else renderKasTable();
    }

    function renderKasTable() {
      const tbodyMasuk = document.getElementById('table-pemasukan-body');
      if (tbodyMasuk) {
        const allMasuk = getIntegratedPemasukanList().filter(p => matchesPeriod(p, 'pemasukan'));
        const totalMasuk = allMasuk.reduce((s, i) => s + (i.nominal || 0), 0);
        document.getElementById('pemasukan-total-label').innerText = `Total Aliran Kas Masuk: Rp${totalMasuk.toLocaleString('id-ID')}`;

        tbodyMasuk.innerHTML = allMasuk.length === 0
          ? `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">Belum ada pemasukan</td></tr>`
          : allMasuk.slice(0, 50).map((p, idx) => `
            <tr class="hover:bg-gray-50/60 transition">
              <td class="px-4 sm:px-6 py-3 font-semibold">${idx + 1}</td>
              <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${p.tanggal}</td>
              <td class="px-4 sm:px-6 py-3 font-bold text-gray-800 flex items-center gap-1.5">
                ${p.isSystem ? '<span class="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-extrabold">AUTO</span>' : ''}
                <span>${escapeHtml(p.kategori)}</span>
              </td>
              <td class="px-4 sm:px-6 py-3">${p.metode}</td>
              <td class="px-4 sm:px-6 py-3 font-bold text-emerald-600">Rp${(p.nominal || 0).toLocaleString('id-ID')}</td>
              <td class="px-4 sm:px-6 py-3 text-gray-500">${p.catatan || '-'}</td>
              <td class="px-4 sm:px-6 py-3 text-right whitespace-nowrap">
                ${!p.isSystem ? `<button type="button" onclick="deleteKas('pemasukan', '${p.id}')" class="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white transition font-bold text-[11px] whitespace-nowrap shadow-sm" title="Hapus arus pemasukan"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>Hapus</span></button>` : '<span class="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-gray-500 text-[10px] font-semibold">Sistem</span>'}
              </td>
            </tr>
          `).join('');
      }

      const tbodyKeluar = document.getElementById('table-pengeluaran-body');
      if (tbodyKeluar) {
        const filteredPengeluarans = pengeluarans.filter(p => matchesPeriod(p, 'pengeluaran'));
        const totalSemuaKeluar = filteredPengeluarans.reduce((s, i) => s + (i.nominal || 0), 0);
        const expToko = filteredPengeluarans.filter(p => !p.expenseType || p.expenseType === 'toko');
        const expBri = filteredPengeluarans.filter(p => p.expenseType === 'brilink');

        const totalToko = expToko.reduce((s, i) => s + (i.nominal || 0), 0);
        const totalBri = expBri.reduce((s, i) => s + (i.nominal || 0), 0);

        document.getElementById('pengeluaran-total-label').innerText = `Total: Rp${totalSemuaKeluar.toLocaleString('id-ID')} (Toko: Rp${totalToko.toLocaleString('id-ID')} | BRI Link: Rp${totalBri.toLocaleString('id-ID')})`;
        document.getElementById('card-exp-total').innerText = 'Rp' + totalSemuaKeluar.toLocaleString('id-ID');
        document.getElementById('card-exp-count').innerText = `${filteredPengeluarans.length} pengeluaran total`;
        document.getElementById('card-exp-toko').innerText = 'Rp' + totalToko.toLocaleString('id-ID');
        document.getElementById('card-exp-brilink').innerText = 'Rp' + totalBri.toLocaleString('id-ID');

        let filteredKeluar = filteredPengeluarans;
        if (activePengeluaranTab === 'toko') filteredKeluar = expToko;
        else if (activePengeluaranTab === 'brilink') filteredKeluar = expBri;

        tbodyKeluar.innerHTML = filteredKeluar.length === 0
          ? `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">Tidak ada catatan pengeluaran (${activePengeluaranTab})</td></tr>`
          : filteredKeluar.map((p, idx) => {
            const isBri = p.expenseType === 'brilink';
            return `
              <tr class="hover:bg-gray-50/60 transition">
                <td class="px-4 sm:px-6 py-3 font-semibold">${idx + 1}</td>
                <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${p.tanggal}</td>
                <td class="px-4 sm:px-6 py-3">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isBri ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}">
                    ${isBri ? 'BRI LINK' : 'TOKO'}
                  </span>
                </td>
                <td class="px-4 sm:px-6 py-3 font-bold text-gray-800">${escapeHtml(p.kategori)}</td>
                <td class="px-4 sm:px-6 py-3">${p.metode}</td>
                <td class="px-4 sm:px-6 py-3 font-bold text-red-600">Rp${(p.nominal || 0).toLocaleString('id-ID')}</td>
                <td class="px-4 sm:px-6 py-3 text-gray-500">${p.catatan || '-'}</td>
                <td class="px-4 sm:px-6 py-3 text-right">
                  <button onclick="deleteKas('pengeluaran', '${p.id}')" class="text-gray-400 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
              </tr>
            `;
          }).join('');
      }
      lucide.createIcons();
    }

    function openModalRetur(defaultType = 'pelanggan') {
      const modal = document.getElementById('modal-retur');
      const select = document.getElementById('retur-barang-id');
      const typeSelect = document.getElementById('retur-type');
      const qtyInput = document.getElementById('retur-qty');
      const alasanInput = document.getElementById('retur-alasan');

      if (!modal || !select || !typeSelect) {
        console.error('Modal retur tidak ditemukan di halaman.');
        showToast('Form retur tidak tersedia.');
        return;
      }

      // Jangan bergantung pada variabel productId global yang tidak selalu ada.
      // Jika sebelumnya ada pilihan barang, pertahankan pilihan tersebut.
      const previousProductId = String(select.value || '');
      const list = Array.isArray(products) ? products : [];

      if (!list.length) {
        select.innerHTML = '<option value="">Belum ada barang</option>';
        showToast('Belum ada barang yang dapat diretur.');
      } else {
        select.innerHTML = list.map(p => {
          const id = String(p.id ?? '');
          const nama = String(p.nama ?? 'Barang');
          const stok = Number(p.stok) || 0;
          return `<option value="${id.replace(/\"/g, '&quot;')}">${nama.replace(/</g, '&lt;')} (Stok saat ini: ${stok})</option>`;
        }).join('');
        if (previousProductId && list.some(p => String(p.id) === previousProductId)) {
          select.value = previousProductId;
        }
      }

      typeSelect.value = defaultType === 'supplier' ? 'supplier' : 'pelanggan';
      if (qtyInput) qtyInput.value = '1';
      if (alasanInput) alasanInput.value = '';

      updateReturTypeUI();
      updateReturPricePreview();
      modal.classList.remove('hidden');
    }

    function updateReturTypeUI() {
      const t = document.getElementById('retur-type').value;
      document.getElementById('modal-retur-title').innerText = t === 'pelanggan'
        ? 'Retur Pelanggan (+ Stok & Pengeluaran Kas Refund)'
        : 'Retur Supplier (- Stok & Pemasukan Kas Pengganti)';
    }

    function updateReturPricePreview() {
      const prodId = document.getElementById('retur-barang-id').value;
      const qty = parseInt(document.getElementById('retur-qty').value) || 0;
      const priceType = document.getElementById('retur-price-type').value;

      const prod = products.find(p => String(p.id) === String(prodId));
      if (!prod) {
        document.getElementById('retur-total-preview').innerText = 'Rp0';
        return;
      }
      const unitPrice = priceType === 'barang'
        ? 0
        : (priceType === 'modal'
          ? Number(prod.hModal || 0)
          : (priceType === 'grosir' ? Number(prod.hGrosir || prod.hJual || 0) : Number(prod.hJual || 0)));
      const total = unitPrice * qty;
      document.getElementById('retur-total-preview').innerText = 'Rp' + total.toLocaleString('id-ID');
    }

    async function saveRetur(e) {
      if (e) e.preventDefault();

      const typeEl = document.getElementById('retur-type');
      const productEl = document.getElementById('retur-barang-id');
      const qtyEl = document.getElementById('retur-qty');
      const priceTypeEl = document.getElementById('retur-price-type');
      const alasanEl = document.getElementById('retur-alasan');

      const type = typeEl ? String(typeEl.value || '').trim().toLowerCase() : '';
      const prodId = productEl ? String(productEl.value || '').trim() : '';
      const qty = Math.floor(Number(qtyEl ? qtyEl.value : 0));

      if (type !== 'pelanggan' && type !== 'supplier') {
        showToast('Jenis retur tidak valid');
        return;
      }
      if (!prodId) {
        showToast('Pilih barang terlebih dahulu');
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        showToast('Jumlah retur harus lebih dari 0');
        return;
      }

      if (isFirebaseReady) {
        try {
          const call = getCloudFunction('createReturn');
          if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
          const response = await call({
            operationId: makeOperationId('RETURN'), type, productId: prodId, qty, priceType, alasan,
            user: currentActorPayload()
          });
          const result = response.data || {};
          const entry = result.retur;
          if (!entry) throw new Error('Server tidak mengembalikan data retur.');
          closeModal('modal-retur');
          const form = document.getElementById('form-retur'); if (form) form.reset();
          addLog('RETURN', `Retur ${type}: ${entry.barangNama} (${qty}x)`);
          showToast(priceType === 'barang' ? `Retur barang ${entry.barangNama} berhasil dicatat.` : `Retur ${type} ${entry.barangNama} berhasil diproses.`);
          return;
        } catch (err) {
          console.error('Retur gagal:', err);
          showToast(err?.message || 'Retur gagal diproses.');
          return;
        }
      }

      // Ambil produk TERBARU dari state lokal.
      const prod = products.find(p => String(p.id) === prodId);
      if (!prod) {
        showToast('Barang retur tidak ditemukan');
        return;
      }

      const stokSebelum = Math.max(0, Number(prod.stok) || 0);

      // LOGIKA UTAMA RETUR:
      // - Retur Pelanggan + nilai refund uang: stok bertambah.
      // - Retur Supplier + nilai refund uang: stok berkurang.
      // - Retur Barang: hanya mencatat retur, TIDAK mengubah stok.
      let stokSesudah;
      if (priceType === 'barang') {
        stokSesudah = stokSebelum;
      } else if (type === 'pelanggan') {
        stokSesudah = stokSebelum + qty;
      } else {
        if (qty > stokSebelum) {
          alert(`Stok tidak cukup untuk retur supplier.\nStok saat ini: ${stokSebelum}\nJumlah retur: ${qty}`);
          return;
        }
        stokSesudah = stokSebelum - qty;
      }

      const priceType = priceTypeEl ? String(priceTypeEl.value || 'eceran').trim().toLowerCase() : 'eceran';
      const alasan = alasanEl ? String(alasanEl.value || '').trim() : '';
      if (!alasan) {
        showToast('Alasan retur wajib diisi');
        return;
      }

      const unitPrice = Number(
        priceType === 'modal'
          ? (prod.hModal ?? 0)
          : priceType === 'grosir'
            ? (prod.hGrosir ?? prod.hJual ?? 0)
            : (prod.hJual ?? 0)
      ) || 0;
      const totalNilai = unitPrice * qty;

      const now = new Date();
      const dateKey = getLocalDateKey(now);
      const timeStr = now.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';

      const returNum = 'RET-' + dateKey.replace(/-/g, '') + '-' +
        String(Date.now()).slice(-6);

      // Ubah stok di state lokal SEBELUM render.
      prod.stok = stokSesudah;

      const stokEntry = {
        id: 'STK-RET-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        timestamp: Date.now(),
        dateKey,
        waktu: timeStr,
        barang: prod.nama,
        barangId: prod.id,
        tipe: type === 'pelanggan' ? 'RETURN_IN' : 'RETURN_OUT',
        qty: type === 'pelanggan' ? qty : -qty,
        sebelum: stokSebelum,
        setelah: stokSesudah,
        user: currentUser?.name || currentUser?.nama || 'User'
      };

      const returEntry = {
        id: returNum,
        timestamp: Date.now(),
        type,
        dateKey,
        waktu: timeStr,
        barangId: prod.id,
        barangNama: prod.nama,
        qty,
        priceType,
        detail: `${prod.nama} (${qty}x @Rp${unitPrice.toLocaleString('id-ID')}) - ${alasan}`,
        nilai: totalNilai,
        user: currentUser?.name || currentUser?.nama || 'User',
        stokSebelum,
        stokSesudah,
        stokLogId: stokEntry.id
      };

      // Simpan data lokal dahulu supaya tampilan langsung berubah.
      returs.unshift(returEntry);
      stokLogs.unshift(stokEntry);

      // Retur pelanggan = uang dikembalikan kepada pelanggan.
      if (type === 'pelanggan' && priceType !== 'barang') {
        const expEntry = {
          id: 'EXP-RET-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          expenseType: 'toko',
          jenisPengeluaran: 'toko',
          dateKey,
          tanggal: timeStr,
          kategori: 'Refund Retur Pelanggan',
          metode: 'CASH',
          nominal: totalNilai,
          catatan: `Barang: ${prod.nama} (${qty}x) - ${alasan}`,
          source: 'retur',
          returId: returNum
        };
        pengeluarans.unshift(expEntry);
        returEntry.expenseId = expEntry.id;
        await syncToCloud("pengeluarans", expEntry.id, expEntry);
      }

      // Retur supplier = supplier mengembalikan uang kepada toko.
      if (type === 'supplier' && priceType !== 'barang') {
        const incomeEntry = {
          id: 'IN-RET-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          timestamp: Date.now(),
          dateKey,
          tanggal: timeStr,
          kategori: 'Pengembalian Retur Supplier',
          metode: 'CASH',
          nominal: totalNilai,
          catatan: `Barang: ${prod.nama} (${qty}x) - ${alasan}`,
          source: 'retur',
          returId: returNum
        };
        pemasukans.unshift(incomeEntry);
        returEntry.incomeId = incomeEntry.id;
        await syncToCloud("pemasukans", incomeEntry.id, incomeEntry);
      }

      // Persist produk + histori retur + log stok.
      await syncToCloud("products", String(prod.id), {
        ...prod,
        stok: stokSesudah
      });
      await syncToCloud("returs", returEntry.id, returEntry);
      await syncToCloud("stokLogs", stokEntry.id, stokEntry);

      addLog('RETURN', `Retur ${type}: ${prod.nama} (${qty}x)`);

      // Refresh semua tampilan yang berkaitan dengan stok/kas/retur.
      renderReturTable();
      renderStokTable();
      renderProductsTable();
      renderKasTable();
      renderDashboard();
      renderLaporan();
      renderPopupBarangList();

      closeModal('modal-retur');
      const form = document.getElementById('form-retur');
      if (form) form.reset();

      showToast(
        priceType === 'barang'
          ? `Retur barang ${prod.nama} berhasil dicatat. Stok tidak berubah.`
          : (type === 'pelanggan'
            ? `Berhasil! Stok ${prod.nama} bertambah ${qty} (retur pelanggan).`
            : `Berhasil! Stok ${prod.nama} berkurang ${qty} (retur supplier).`)
      );
    }

    function switchReturTab(tab) {
      activeReturTab = tab;
      document.querySelectorAll('.retur-tab').forEach(b => {
        if (b.innerText.toLowerCase() === tab) {
          b.className = 'retur-tab text-emerald-700 border-b-2 border-emerald-600 pb-2 font-bold';
        } else {
          b.className = 'retur-tab text-gray-400 pb-2 hover:text-gray-700';
        }
      });
      renderReturTable();
    }

    function renderReturTable() {
      const tbody = document.getElementById('table-retur-body');
      const filtered = returs.filter(r => activeReturTab === 'semua' || r.type === activeReturTab);
      const isAdmin = currentUser && currentUser.role === 'admin';

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">Belum ada data retur</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(r => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900">${r.id}</td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.type === 'pelanggan' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'} uppercase">${r.type}</span></td>
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${r.waktu}</td>
          <td class="px-4 sm:px-6 py-3 font-medium text-gray-800">${r.detail}</td>
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-900">Rp${r.nilai.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">${r.user}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            ${isAdmin ? `<button onclick="deleteRetur('${r.id}')" class="text-gray-400 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    async function deleteRetur(id) {
      if (!confirm('Hapus data retur ini dan batalkan mutasi stok/kas terkait?')) return;
      try {
        if (isFirebaseReady) {
          const call = getCloudFunction('deleteReturnAtomic');
          if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
          await call({ id: String(id), user: currentActorPayload() });
        } else {
          const retur = returs.find(r => String(r.id) === String(id));
          if (!retur) { showToast('Data retur tidak ditemukan'); return; }
          const prod = products.find(p => String(p.id) === String(retur.barangId));
          if (prod && retur.priceType !== 'barang') {
            const qty = Number(retur.qty) || 0;
            if (retur.type === 'pelanggan') {
              if (Number(prod.stok) < qty) throw new Error('Stok saat ini tidak cukup untuk membatalkan retur pelanggan.');
              prod.stok -= qty;
            } else prod.stok += qty;
          }
          returs = returs.filter(r => String(r.id) !== String(id));
        }
        renderReturTable(); renderStokTable(); renderProductsTable(); renderKasTable(); renderDashboard(); renderLaporan();
        showToast('Retur dihapus dan mutasi dibatalkan.');
      } catch (err) {
        console.error('Hapus retur gagal:', err);
        showToast(err?.message || 'Gagal menghapus retur.');
      }
    }

    function openModalBriLink() { openModal('modal-brilink'); }

    async function saveBriLinkTx(e) {
      e.preventDefault();
      const jenis = document.getElementById('bri-jenis').value;
      const nominal = parseInt(document.getElementById('bri-nominal').value) || 0;
      const fee = parseInt(document.getElementById('bri-fee').value) || 0;
      const profit = parseInt(document.getElementById('bri-profit').value) || 0;

      const now = new Date();
      const dateKey = getLocalDateKey(now);
      const timeStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
      const briSeq = nextLocalNumber('brilinks', dateKey);
      const briId = 'BRI-' + dateKey.replace(/-/g, '') + '-' + String(briSeq).padStart(4, '0');

      const entry = { id: briId, timestamp: Date.now(), dateKey, waktu: timeStr, jenis, nominal, fee, profit, user: currentUser.name };
      
      if (!isFirebaseReady) brilinks.unshift(entry);
      else await syncToCloud("brilinks", briId, entry);

      addLog('BRI_LINK_TXN', `BRI Link ${briId} profit Rp${profit.toLocaleString('id-ID')}`);
      closeModal('modal-brilink');
      renderBriLinkTable();
      renderDashboard();
      renderLaporan();
      renderKasTable();
      clearExecutedForm('form-brilink');
      showToast(isFirebaseReady ? 'Transaksi BRI Link tersimpan di Cloud.' : 'Transaksi BRI Link tersimpan di perangkat.');
    }

    async function deleteBriLink(id) {
      if (!confirm(`Hapus transaksi BRI Link "${id}"?`)) return;
      if (!isFirebaseReady) brilinks = brilinks.filter(b => b.id !== id);
      else await deleteFromCloud("brilinks", id);
      renderBriLinkTable();
      renderDashboard();
      renderLaporan();
      renderKasTable();
      showToast('Transaksi BRI Link dihapus');
    }

    function renderBriLinkTable() {
      const tbody = document.getElementById('table-brilink-body');
      const filteredBri = brilinks.filter(b => matchesPeriod(b, 'brilink'));
      const totalVolume = filteredBri.reduce((s, i) => s + (i.nominal || 0), 0);
      const totalProfit = filteredBri.reduce((s, i) => s + (i.profit || 0), 0);
      const isAdmin = currentUser && currentUser.role === 'admin';

      document.getElementById('brilink-volume-total').innerText = 'Rp' + totalVolume.toLocaleString('id-ID');
      document.getElementById('brilink-profit-total').innerText = 'Rp' + totalProfit.toLocaleString('id-ID');
      document.getElementById('brilink-profit-today').innerText = 'Rp' + totalProfit.toLocaleString('id-ID');
      document.getElementById('brilink-tx-today').innerText = `${filteredBri.length} transaksi`;

      if (filteredBri.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">Belum ada transaksi BRI Link</td></tr>`;
        return;
      }

      tbody.innerHTML = filteredBri.map(b => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900">${b.id}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${b.waktu}</td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-600">${b.jenis}</span></td>
          <td class="px-4 sm:px-6 py-3 font-medium text-gray-900">Rp${b.nominal.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">Rp${b.fee.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 font-bold text-emerald-600">Rp${b.profit.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">${b.user}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            ${isAdmin ? `<button onclick="deleteBriLink('${b.id}')" class="text-gray-400 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    let chart1, chart2, chartLaporanTokoObj, chartLaporanBriObj;

    function switchLaporanTab(tab) {
      activeLaporanTab = tab;
      const secToko = document.getElementById('section-laporan-toko');
      const secBri = document.getElementById('section-laporan-brilink');
      const btnToko = document.getElementById('tab-btn-toko');
      const btnBri = document.getElementById('tab-btn-brilink');

      if (tab === 'toko') {
        secToko.classList.remove('hidden');
        secBri.classList.add('hidden');
        btnToko.className = 'pb-2 text-emerald-600 border-b-2 border-emerald-600 flex items-center space-x-1.5 font-bold';
        btnBri.className = 'pb-2 text-gray-400 hover:text-gray-600 flex items-center space-x-1.5 font-semibold';
      } else {
        secToko.classList.add('hidden');
        secBri.classList.remove('hidden');
        btnBri.className = 'pb-2 text-blue-600 border-b-2 border-blue-600 flex items-center space-x-1.5 font-bold';
        btnToko.className = 'pb-2 text-gray-400 hover:text-gray-600 flex items-center space-x-1.5 font-semibold';
      }
      renderLaporan();
    }

    function getLaporanPeriod() {
      const input = document.getElementById('laporan-period');
      const now = new Date();
      const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const value = input?.value || fallback;
      const [year, month] = value.split('-').map(Number);
      return {
        value,
        year: year || now.getFullYear(),
        month: month || now.getMonth() + 1,
        label: new Date(year || now.getFullYear(), (month || now.getMonth() + 1) - 1, 1)
          .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
      };
    }

    function renderLaporan() {
      const period = getLaporanPeriod();
      const { year, month, label } = period;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      // Semua sumber transaksi yang masuk laporan.
      const validTx = transactions.filter(t =>
        t.status !== 'DIBATALKAN' && String(t.dateKey || '').startsWith(monthKey)
      );
      const monthExp = pengeluarans.filter(p =>
        String(p.dateKey || '').startsWith(monthKey)
      );
      const monthInc = pemasukans.filter(p =>
        String(p.dateKey || '').startsWith(monthKey)
      );
      const monthRetur = returs.filter(r =>
        String(r.dateKey || '').startsWith(monthKey)
      );
      const monthBri = brilinks.filter(b =>
        String(b.dateKey || '').startsWith(monthKey)
      );

      const n = v => Number(v) || 0;

      const totalSales = validTx.reduce((s, i) => s + n(i.total), 0);
      const grossProfit = validTx.reduce((s, i) => s + n(i.profit), 0);

      const tokoExp = monthExp.filter(p => !p.expenseType || p.expenseType === 'toko');
      const briExp = monthExp.filter(p => p.expenseType === 'brilink');
      const totalExpToko = tokoExp.reduce((s, i) => s + n(i.nominal), 0);
      const totalExpBri = briExp.reduce((s, i) => s + n(i.nominal), 0);

      // Pemasukan manual saja. Pemasukan retur supplier dipisahkan agar tidak dihitung dua kali.
      const manualInc = monthInc.filter(p => p.source !== 'retur');
      const totalPemasukan = manualInc.reduce((s, i) => s + n(i.nominal), 0);

      const returPelanggan = monthRetur.filter(r => r.type === 'pelanggan');
      const returSupplier = monthRetur.filter(r => r.type === 'supplier');

      const totalRefundReturPelanggan = returPelanggan.reduce((s, r) => s + n(r.nilai), 0);
      const totalReturSupplier = returSupplier.reduce((s, r) => s + n(r.nilai), 0);

      // Hasil bersih mencakup seluruh arus pembukuan toko:
      // laba kotor + pemasukan manual + pengembalian supplier
      // - pengeluaran toko - refund retur pelanggan.
      const netProfitToko =
        grossProfit +
        totalPemasukan +
        totalReturSupplier -
        totalExpToko -
        totalRefundReturPelanggan;

      const setMoney = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = 'Rp' + n(value).toLocaleString('id-ID');
      };

      setMoney('lap-penjualan', totalSales);
      setMoney('lap-labakotor', grossProfit);
      setMoney('lap-pemasukan', totalPemasukan);
      setMoney('lap-retur-supplier', totalReturSupplier);
      setMoney('lap-pengeluaran', totalExpToko);
      setMoney('lap-retur-pelanggan', totalRefundReturPelanggan);
      setMoney('lap-lababersih', netProfitToko);

      // BRI Link tetap dilaporkan terpisah.
      const briVol = monthBri.reduce((s, i) => s + n(i.nominal), 0);
      const briFee = monthBri.reduce((s, i) => s + n(i.fee), 0);
      const briGrossProfit = monthBri.reduce((s, i) => s + n(i.profit), 0);
      const briNetProfit = briGrossProfit - totalExpBri;

      setMoney('lap-bri-volume', briVol);
      setMoney('lap-bri-fee', briFee);
      setMoney('lap-bri-exp', totalExpBri);
      setMoney('lap-bri-profit', briNetProfit);

      const labelToko = document.getElementById('label-bulan-laporan');
      const labelBri = document.getElementById('label-bulan-laporan-bri');
      if (labelToko) labelToko.innerText = label;
      if (labelBri) labelBri.innerText = label;

      const tbodyToko = document.getElementById('table-laporan-harian');
      const tbodyBri = document.getElementById('table-laporan-brilink-harian');
      let rowsToko = '';
      let rowsBri = '';

      const totalDays = new Date(year, month, 0).getDate();
      const daysArr = Array.from({ length: totalDays }, (_, i) => String(i + 1).padStart(2, '0'));
      const sData = new Array(totalDays).fill(0);
      const lData = new Array(totalDays).fill(0);
      const briProfitData = new Array(totalDays).fill(0);

      for (let day = 1; day <= totalDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const isoDate = `${monthKey}-${dayStr}`;
        const dStr = `${dayStr}/${String(month).padStart(2, '0')}/${year}`;

        const dayTx = validTx.filter(t => t.dateKey === isoDate);
        const sVal = dayTx.reduce((acc, t) => acc + n(t.total), 0);
        const lVal = dayTx.reduce((acc, t) => acc + n(t.profit), 0);

        const dayInc = manualInc.filter(p => p.dateKey === isoDate)
          .reduce((acc, p) => acc + n(p.nominal), 0);

        const dayReturSupplier = returSupplier.filter(r => r.dateKey === isoDate)
          .reduce((acc, r) => acc + n(r.nilai), 0);

        const dayExpToko = tokoExp.filter(p => p.dateKey === isoDate)
          .reduce((acc, p) => acc + n(p.nominal), 0);

        const dayRefund = returPelanggan.filter(r => r.dateKey === isoDate)
          .reduce((acc, r) => acc + n(r.nilai), 0);

        const netVal = lVal + dayInc + dayReturSupplier - dayExpToko - dayRefund;

        sData[day - 1] = sVal;
        lData[day - 1] = lVal;

        rowsToko += `<tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-medium whitespace-nowrap">${dStr}</td>
          <td class="px-4 sm:px-6 py-3 text-right">Rp${sVal.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-emerald-700 font-bold">Rp${lVal.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-blue-600">Rp${dayInc.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-cyan-600">Rp${dayReturSupplier.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-red-600">Rp${dayExpToko.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-orange-600">Rp${dayRefund.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right font-extrabold ${netVal >= 0 ? 'text-emerald-700' : 'text-rose-600'}">Rp${netVal.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            <button onclick="hapusLaporanTanggalTertentu('${isoDate}')" class="text-gray-400 hover:text-red-600 p-1" title="Hapus seluruh data tanggal ini">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>`;

        const dayBri = monthBri.filter(b => b.dateKey === isoDate);
        const bVol = dayBri.reduce((acc, b) => acc + n(b.nominal), 0);
        const bFee = dayBri.reduce((acc, b) => acc + n(b.fee), 0);
        const bProfitGross = dayBri.reduce((acc, b) => acc + n(b.profit), 0);
        const dayExpBri = briExp.filter(p => p.dateKey === isoDate)
          .reduce((acc, p) => acc + n(p.nominal), 0);
        const bNetProfit = bProfitGross - dayExpBri;

        briProfitData[day - 1] = bNetProfit;
        rowsBri += `<tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-medium whitespace-nowrap">${dStr}</td>
          <td class="px-4 sm:px-6 py-3 text-right">Rp${bVol.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-teal-600 font-medium">Rp${bFee.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-red-500 font-medium">Rp${dayExpBri.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right text-emerald-700 font-bold">Rp${bNetProfit.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            <button onclick="hapusLaporanTanggalTertentu('${isoDate}')" class="text-gray-400 hover:text-red-600 p-1" title="Hapus laporan tanggal ini">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>`;
      }

      if (tbodyToko) tbodyToko.innerHTML = rowsToko;
      if (tbodyBri) tbodyBri.innerHTML = rowsBri;

      const ctxToko = document.getElementById('chartLaporanToko');
      if (ctxToko) {
        if (chartLaporanTokoObj) chartLaporanTokoObj.destroy();
        chartLaporanTokoObj = new Chart(ctxToko, {
          type: 'line',
          data: {
            labels: daysArr,
            datasets: [
              { label: 'Penjualan', data: sData, borderColor: '#10b981', tension: 0.3 },
              { label: 'Laba Kotor', data: lData, borderColor: '#059669', tension: 0.3 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
      }

      const ctxBri = document.getElementById('chartLaporanBri');
      if (ctxBri) {
        if (chartLaporanBriObj) chartLaporanBriObj.destroy();
        chartLaporanBriObj = new Chart(ctxBri, {
          type: 'bar',
          data: {
            labels: daysArr,
            datasets: [{ label: 'Laba Bersih Agen (Rp)', data: briProfitData, backgroundColor: '#3b82f6', borderRadius: 4 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
      }

      lucide.createIcons();
    }

    function openModalStok(mode, productId = '') {
      document.getElementById('stok-mode').value = mode;
      document.getElementById('modal-stok-title').innerText = mode === 'tambah' ? 'Tambah Stok Barang' : mode === 'kurang' ? 'Kurangi Stok Barang' : 'Penyesuaian Stok (Opname)';
      document.getElementById('stok-qty-label').innerText = mode === 'tambah' ? 'Jumlah Tambahan Stok' : mode === 'kurang' ? 'Jumlah Stok yang Dikurangi' : 'Stok Fisik Sebenarnya';

      const select = document.getElementById('stok-barang-id');
      select.innerHTML = products.map(p => `<option value="${p.id}" ${String(p.id) === String(productId) ? 'selected' : ''}>${escapeHtml(p.nama)} (Stok saat ini: ${p.stok})</option>`).join('');
      openModal('modal-stok');
    }

    async function saveStokMovement(e) {
      e.preventDefault();
      const mode = document.getElementById('stok-mode').value;
      const prodId = document.getElementById('stok-barang-id').value;
      const qtyInput = parseInt(document.getElementById('stok-qty').value) || 0;

      const prod = products.find(p => String(p.id) === String(prodId));
      if (!prod) return;

      if (qtyInput <= 0) {
        showToast('Jumlah stok harus lebih dari 0');
        return;
      }

      if (isFirebaseReady) {
        try {
          const call = getCloudFunction('applyStockMovementAtomic');
          if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
          const response = await call({ mode, productId: prodId, qty: qtyInput, user: currentActorPayload() });
          const result = response.data || {};
          closeModal('modal-stok');
          clearExecutedForm('form-stok');
          addLog(result.tipe || 'STOCK', `${result.tipe || 'STOCK'}: ${prod.nama} (${result.delta >= 0 ? '+' : ''}${result.delta})`);
          showToast('Mutasi stok berhasil diproses secara atomic.');
          return;
        } catch (err) {
          console.error('Mutasi stok gagal:', err);
          showToast(err?.message || 'Mutasi stok gagal.');
          return;
        }
      }

      const sebelum = Number(prod.stok) || 0;
      let tipe = 'RESTOCK';
      let delta = qtyInput;

      if (mode === 'tambah') {
        prod.stok = sebelum + qtyInput;
      } else if (mode === 'kurang') {
        if (qtyInput > sebelum) {
          showToast(`Stok tidak cukup. Stok saat ini hanya ${sebelum}`);
          return;
        }
        tipe = 'STOCK_OUT';
        delta = -qtyInput;
        prod.stok = sebelum - qtyInput;
      } else {
        tipe = 'ADJUSTMENT';
        delta = qtyInput - sebelum;
        prod.stok = qtyInput;
      }

      const now = new Date();
      const dateKey = getLocalDateKey(now);
      const timeStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';

      const stokEntry = {
        id: String(Date.now()),
        timestamp: Date.now(),
        dateKey: dateKey,
        waktu: timeStr,
        barang: prod.nama,
        tipe: tipe,
        qty: delta,
        sebelum: sebelum,
        setelah: prod.stok,
        user: currentUser.name
      };

      if (!isFirebaseReady) {
        stokLogs.unshift(stokEntry);
      } else {
        await syncToCloud("products", prod.id, prod);
        await syncToCloud("stokLogs", stokEntry.id, stokEntry);
      }

      addLog(tipe, `${tipe}: ${prod.nama} (${delta >= 0 ? '+' : ''}${delta})`);
      closeModal('modal-stok');
      renderStokTable();
      renderProductsTable();
      clearExecutedForm('form-stok');
      showToast(mode === 'tambah' ? 'Stok berhasil ditambahkan' : mode === 'kurang' ? 'Stok berhasil dikurangi' : 'Stok fisik berhasil diperbarui.');
    }

    function renderStokTable() {
      const tbody = document.getElementById('table-stok-body');
      const isAdmin = currentUser && currentUser.role === 'admin';
      if (stokLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">Belum ada riwayat mutasi stok</td></tr>`;
        return;
      }
      tbody.innerHTML = stokLogs.map(l => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${l.waktu}</td>
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900 whitespace-nowrap">${l.barang}</td>
          <td class="px-4 sm:px-6 py-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${l.tipe === 'SALE' ? 'bg-blue-50 text-blue-600' : l.tipe === 'RESTOCK' ? 'bg-emerald-50 text-emerald-600' : l.tipe.startsWith('RETURN') ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'}">${l.tipe}</span>
          </td>
          <td class="px-4 sm:px-6 py-3 font-bold ${l.qty < 0 ? 'text-red-600' : 'text-emerald-600'}">${l.qty > 0 ? '+' : ''}${l.qty}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">${l.sebelum}</td>
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-900">${l.setelah}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500">${l.user}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            ${isAdmin ? `<button onclick="deleteStokLog('${l.id}')" class="text-gray-400 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    async function deleteStokLog(id) {
      if (!confirm('Hapus catatan mutasi stok ini?')) return;
      if (!isFirebaseReady) stokLogs = stokLogs.filter(s => s.id !== id);
      else await deleteFromCloud("stokLogs", id);
      renderStokTable();
      showToast('Catatan stok dihapus');
    }

    function getTodayISODate() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function getLocalDateKey(d) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function getCurrentMonthISO() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }

    function getItemDateKey(item) {
      if (item && item.dateKey) {
        const key = String(item.dateKey).trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
      }
      if (item && item.timestamp) {
        const d = new Date(Number(item.timestamp));
        if (!isNaN(d.getTime())) return getLocalDateKey(d);
      }
      return '';
    }

    function initializeDateFilters() {
      const today = getTodayISODate();
      ['filter-tx-date','filter-pemasukan-date','filter-pengeluaran-date','filter-brilink-date','laporan-delete-date','dash-report-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
      });
      const month = document.getElementById('dash-report-month');
      if (month) month.value = today.slice(0,7);
      const mode = document.getElementById('dash-report-mode');
      if (mode) mode.value = 'day';
    }

    function getDashboardMode() {
      return document.getElementById('dash-report-mode')?.value || 'day';
    }

    function getDashboardDate() {
      return document.getElementById('dash-report-date')?.value || getTodayISODate();
    }

    function getDashboardMonth() {
      return document.getElementById('dash-report-month')?.value || getDashboardDate().slice(0,7);
    }

    function setDashboardToday() {
      const today = getTodayISODate();
      const dateEl = document.getElementById('dash-report-date');
      const monthEl = document.getElementById('dash-report-month');
      const modeEl = document.getElementById('dash-report-mode');
      if (dateEl) dateEl.value = today;
      if (monthEl) monthEl.value = today.slice(0,7);
      if (modeEl) modeEl.value = 'day';
      renderDashboard();
    }

    function renderDashboard() {
      const mode = getDashboardMode();
      const selectedDate = getDashboardDate();
      const selectedMonth = getDashboardMonth();
      const dateWrap = document.getElementById('dash-date-wrap');
      const monthWrap = document.getElementById('dash-month-wrap');
      if (dateWrap) dateWrap.classList.toggle('hidden', mode === 'month');
      if (monthWrap) monthWrap.classList.toggle('hidden', mode !== 'month');

      let validTx, selectedExpenses, selectedBri;
      if (mode === 'month') {
        validTx = transactions.filter(t => t.status !== 'DIBATALKAN' && getItemDateKey(t).slice(0,7) === selectedMonth);
        selectedExpenses = pengeluarans.filter(p => getItemDateKey(p).slice(0,7) === selectedMonth);
        selectedBri = brilinks.filter(b => getItemDateKey(b).slice(0,7) === selectedMonth);
      } else {
        validTx = transactions.filter(t => t.status !== 'DIBATALKAN' && getItemDateKey(t) === selectedDate);
        selectedExpenses = pengeluarans.filter(p => getItemDateKey(p) === selectedDate);
        selectedBri = brilinks.filter(b => getItemDateKey(b) === selectedDate);
      }

      const totalSales = validTx.reduce((s, i) => s + (Number(i.total) || 0), 0);
      const totalProfit = validTx.reduce((s, i) => s + (Number(i.profit) || 0), 0);
      const totalExpenses = selectedExpenses.reduce((s, i) => s + (Number(i.nominal) || 0), 0);
      const expToko = selectedExpenses.filter(p => !p.expenseType || p.expenseType === 'toko').reduce((s, i) => s + (Number(i.nominal) || 0), 0);
      const expBri = selectedExpenses.filter(p => p.expenseType === 'brilink').reduce((s, i) => s + (Number(i.nominal) || 0), 0);
      const totalBriLink = selectedBri.reduce((s, i) => s + (Number(i.profit) || 0), 0);

      let periodText;
      if (mode === 'month') {
        const d = new Date(`${selectedMonth}-01T00:00:00`);
        periodText = d.toLocaleDateString('id-ID', { month:'long', year:'numeric' });
      } else {
        const d = new Date(`${selectedDate}T00:00:00`);
        periodText = d.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });
      }

      const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
      setText('dash-sales-today', 'Rp' + totalSales.toLocaleString('id-ID'));
      setText('dash-tx-today', `${validTx.length} transaksi`);
      setText('dash-profit-today', 'Rp' + totalProfit.toLocaleString('id-ID'));
      setText('dash-expense-today', 'Rp' + totalExpenses.toLocaleString('id-ID'));
      setText('dash-expense-count', `Toko: Rp${expToko.toLocaleString('id-ID')} | BRI: Rp${expBri.toLocaleString('id-ID')}`);
      setText('dash-brilink-today', 'Rp' + totalBriLink.toLocaleString('id-ID'));
      setText('dash-brilink-count', `${selectedBri.length} transaksi`);
      setText('dash-period-label', '');
      ['sales','profit','expense','brilink'].forEach(id => setText(`dash-${id}-label`, mode === 'month' ? 'BULAN DIPILIH' : 'HARI DIPILIH'));
      setText('chart-sales-title', mode === 'month' ? 'HARIAN DALAM BULAN' : 'TANGGAL DIPILIH');
      setText('chart-exp-title', mode === 'month' ? '(HARIAN DALAM BULAN)' : '(TANGGAL DIPILIH)');
      setText('dash-active-products', products.length);
      setText('dash-low-stock', products.filter(p => Number(p.stok || 0) <= 5).length);

      if (currentUser && currentUser.role === 'admin') initCharts();
    }

    function initCharts() {
      const mode = getDashboardMode();
      let labels = [], salesData = [], briData = [], expData = [];

      if (mode === 'month') {
        const month = getDashboardMonth();
        const [y, m] = month.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          labels.push(String(d));
          salesData.push(transactions.filter(t => t.status !== 'DIBATALKAN' && getItemDateKey(t) === key).reduce((s,x) => s + (Number(x.total)||0), 0));
          briData.push(brilinks.filter(x => getItemDateKey(x) === key).reduce((s,x) => s + (Number(x.profit)||0), 0));
          expData.push(pengeluarans.filter(x => getItemDateKey(x) === key).reduce((s,x) => s + (Number(x.nominal)||0), 0));
        }
      } else {
        const selected = getDashboardDate();
        labels = [new Date(`${selected}T00:00:00`).toLocaleDateString('id-ID', { day:'2-digit', month:'short' })];
        salesData = [transactions.filter(t => t.status !== 'DIBATALKAN' && getItemDateKey(t) === selected).reduce((s,x) => s + (Number(x.total)||0), 0)];
        briData = [brilinks.filter(x => getItemDateKey(x) === selected).reduce((s,x) => s + (Number(x.profit)||0), 0)];
        expData = [pengeluarans.filter(x => getItemDateKey(x) === selected).reduce((s,x) => s + (Number(x.nominal)||0), 0)];
      }

      const ctx1 = document.getElementById('chartPenjualan');
      if (ctx1 && typeof Chart !== 'undefined') {
        if (chart1) chart1.destroy();
        chart1 = new Chart(ctx1, { type:'line', data:{ labels, datasets:[{ label:'Penjualan', data:salesData, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.1)', tension:0.3, fill:true }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} } });
      }

      const ctx2 = document.getElementById('chartPengeluaran');
      if (ctx2 && typeof Chart !== 'undefined') {
        if (chart2) chart2.destroy();
        chart2 = new Chart(ctx2, { type:'line', data:{ labels, datasets:[{ label:'BRI Link', data:briData, borderColor:'#3b82f6', tension:0.3 }, { label:'Pengeluaran', data:expData, borderColor:'#ef4444', tension:0.3 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}, scales:{y:{beginAtZero:true}} } });
      }
    }

    let selectedLoginRole = null;

    async function selectLoginRole(role) {
      await localStateReady.catch(() => {});
      selectedLoginRole = role;
      if (role === 'kasir') {
        ensureLocalDefaultAccounts();
        // Kasir benar-benar lokal: hentikan listener/cloud dari sesi Admin sebelumnya.
        await disconnectFirebase();
        setCloudStatus(false);
      } else {
        try {
          setCloudStatus(false);
          await ensureFirebaseReady();
          await loadAdminUsersForLogin();
        } catch (err) {
          showToast('Cloud Admin tidak tersedia. Akun lokal tetap dapat digunakan.');
        }
      }
      document.getElementById('login-role-selection').classList.add('hidden');
      document.getElementById('form-login').classList.remove('hidden');
      document.getElementById('selected-login-role').innerText = role === 'admin' ? 'Admin' : 'Kasir';
      document.getElementById('login-username').value = '';
      document.getElementById('login-password').value = '';
      document.getElementById('login-username').placeholder = 'Masukkan username';
      setTimeout(() => document.getElementById('login-username').focus(), 50);
    }

    function backToLoginRoleSelection() {
      selectedLoginRole = null;
      document.getElementById('form-login').classList.add('hidden');
      document.getElementById('login-role-selection').classList.remove('hidden');
    }

    async function hashPassword(password) {
      const data = new TextEncoder().encode(String(password || ''));
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-login');
      if (btn) btn.disabled = true;
      try {
        const username = document.getElementById('login-username').value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;
        const passwordHash = await hashPassword(password);
        const account = appUsers.find(u => {
          const sameUser = String(u.username || '').trim().toLowerCase() === username;
          const sameRole = String(u.role || '').trim().toLowerCase() === String(selectedLoginRole || '').trim().toLowerCase();
          const samePassword = u.passwordHash ? String(u.passwordHash) === passwordHash : String(u.password ?? '').trim() === password.trim();
          return sameUser && sameRole && samePassword;
        });
        if (!selectedLoginRole || !account) {
          currentUser = null;
          showToast('Username atau password salah. Silakan coba lagi.');
          document.getElementById('login-password').value = '';
          document.getElementById('login-password').focus();
          return;
        }
        currentUser = { name: account.nama, username: account.username, email: account.email, role: String(account.role).toLowerCase(), badge: account.role, badgeColor: account.role === 'ADMIN' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700' };
        if (currentUser.role === 'admin') {
          try { await ensureFirebaseReady(); initRealtimeListeners(); } catch (_) { showToast('Admin berjalan dengan cache lokal karena cloud tidak tersedia.'); }
        } else {
          // Tidak ada Firebase pada sesi Kasir.
          await disconnectFirebase();
          setCloudStatus(false);
        }
        addLog('LOGIN', `Login sebagai ${currentUser.role}`);
        setupEnterStepNavigation();
        setupUserInterface();
        applyStoreInfo();
        document.getElementById('view-login').classList.add('hidden');
        document.getElementById('view-app').classList.remove('hidden');
        showToast('Berhasil masuk. Selamat bertransaksi!');
        navigate(currentUser.role === 'admin' ? 'dashboard' : 'kasir');
        if (currentUser.role === 'kasir') setTimeout(() => { document.getElementById('view-app')?.classList.add('kasir-fullscreen'); resetKasirNavigation(); }, 100);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function exportFullCloudBackup() {
      const payload = {
        exportedAt: new Date().toISOString(),
        storeInfo,
        products, members, transactions, stokLogs, returs, pemasukans, pengeluarans, brilinks, aktivitasLogs
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Backup_TokoBungEdi_${getTodayISODate()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showToast(isFirebaseReady ? 'Backup data cloud/cache berhasil dibuat.' : 'Backup data lokal berhasil dibuat.');
    }

    async function handleLogout() {
      if (currentUser) addLog('LOGOUT', 'User keluar sistem', 'bg-red-50 text-red-600');
      if (currentUser?.role === 'admin') await disconnectFirebase();
      await persistLocalState().catch(() => {});
      document.getElementById('view-app').classList.add('hidden');
      document.getElementById('view-login').classList.remove('hidden');
      currentUser = null;
      cart = [];
      selectedLoginRole = null;
      document.getElementById('login-role-selection')?.classList.remove('hidden');
      document.getElementById('form-login')?.classList.add('hidden');
      closeMobileSidebar();
      setCloudStatus(false);
    }

    function addLog(action, detail, tag = 'bg-emerald-50 text-emerald-600') {
      const now = new Date();
      const timeStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
      const logEntry = {
        id: String(Date.now()),
        timestamp: Date.now(),
        waktu: timeStr,
        user: currentUser ? currentUser.name : 'Sistem',
        action,
        detail,
        tag
      };
      if (!isFirebaseReady) aktivitasLogs.unshift(logEntry);
      else syncToCloud("aktivitasLogs", logEntry.id, logEntry);
    }


    function togglePasswordVisibility() {
      const p = document.getElementById('login-password');
      p.type = p.type === 'password' ? 'text' : 'password';
    }

    function openCalculator() { openModal('modal-kalkulator'); const d=document.getElementById('calc-display'); d.value=''; setTimeout(()=>d.focus(),50); }
    function calcPress(v){ const d=document.getElementById('calc-display'); if(v==='C') d.value=''; else d.value+=v; d.focus(); }
    function calcEquals(){ const d=document.getElementById('calc-display'); try { if(!/^[0-9+\-*/.() ]+$/.test(d.value)) throw new Error(); const result=Function('"use strict";return ('+d.value+')')(); if(!Number.isFinite(result)) throw new Error(); d.value=String(result); } catch(e){ d.value=''; showToast('Perhitungan tidak valid'); } d.focus(); }
    function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
    function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

    let toastTimer;
    function showToast(msg) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      clearTimeout(toastTimer);
      document.getElementById('toast-msg').innerText = msg;
      toast.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
      toast.classList.add('opacity-100');
      toast.style.visibility = 'visible';
      toastTimer = setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        toast.classList.remove('opacity-100');
        toast.style.visibility = 'hidden';
      }, 3000);
    }

    function toggleKasirNavigation() {
      const app = document.getElementById('view-app');
      const btn = document.getElementById('kasir-nav-toggle');
      if (!app || !btn) return;
      const hidden = app.classList.toggle('kasir-fullscreen');
      btn.innerHTML = hidden
        ? '<i data-lucide="menu" class="w-4 h-4"></i><span>Buka Navigasi</span>'
        : '<i data-lucide="menu" class="w-4 h-4"></i><span>Sembunyikan</span>';
      lucide.createIcons();
      setTimeout(() => focusKasirSearch(), 50);
    }

    function resetKasirNavigation() {
      const app = document.getElementById('view-app');
      const btn = document.getElementById('kasir-nav-toggle');
      if (!app || !btn) return;
      app.classList.remove('kasir-fullscreen');
      btn.innerHTML = '<i data-lucide="menu" class="w-4 h-4"></i><span>Navigasi</span>';
      lucide.createIcons();
    }

    function toggleMobileSidebar() {
      document.getElementById('app-sidebar').classList.toggle('-translate-x-full');
      document.getElementById('sidebar-backdrop').classList.toggle('hidden');
    }

    function closeMobileSidebar() {
      document.getElementById('app-sidebar').classList.add('-translate-x-full');
      document.getElementById('sidebar-backdrop').classList.add('hidden');
    }

    // Enter = Next Step pada form. Jika sudah field terakhir, Enter menjalankan submit.
    function setupEnterStepNavigation() {
      document.querySelectorAll('form').forEach(form => {
        if (form.dataset.enterStepperReady) return;
        form.dataset.enterStepperReady = '1';
        form.addEventListener('keydown', function(e) {
          if (e.key !== 'Enter' || e.isComposing) return;
          const el = e.target;
          const controls = [...form.querySelectorAll('input:not([type="hidden"]), select, textarea, button[type="submit"]')]
            .filter(x => !x.disabled && x.offsetParent !== null && x.type !== 'button');
          if (!controls.length) return;
          const idx = controls.indexOf(el);
          if (idx < 0) return;
          e.preventDefault();
          const next = controls[idx + 1];
          if (next) {
            if (next.type === 'submit') form.requestSubmit();
            else { next.focus(); if (next.select) next.select(); }
          } else form.requestSubmit();
        });
      });
    }

    function navigate(pageId) {
      document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
      const active = document.getElementById(`page-${pageId}`);
      if (active) active.classList.remove('hidden');

      document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.dataset.page === pageId) {
          btn.className = 'nav-item flex items-center w-full px-3 py-2 rounded-lg transition space-x-3 bg-emerald-50 text-emerald-700 font-bold';
        } else {
          btn.className = 'nav-item flex items-center w-full px-3 py-2 rounded-lg transition space-x-3 hover:bg-gray-100 text-gray-600 font-medium';
        }
      });
      lucide.createIcons();
      closeMobileSidebar();

      if (pageId === 'kasir') {
        setTimeout(() => {
          const scanInput = document.getElementById('kasir-search');
          if (scanInput && window.innerWidth > 768) scanInput.focus();
        }, 100);
      } else {
        resetKasirNavigation();
      }
    }

    function generateRandomBarcode() {
      const prefix = '899' + Math.floor(1000000000 + Math.random() * 9000000000);
      document.getElementById('barang-barcode').value = prefix;
    }

    function showBarcodeModal(id) {
      const prod = products.find(p => p.id === id);
      if (!prod) return;
      document.getElementById('barcode-label-nama').innerText = prod.nama;
      document.getElementById('barcode-label-price').innerText = 'Rp' + prod.hJual.toLocaleString('id-ID');
      document.getElementById('barcode-label-grosir').innerText = 'Rp' + (prod.hGrosir || prod.hJual).toLocaleString('id-ID');

      JsBarcode("#barcode-svg", prod.barcode || prod.kode, {
        format: "CODE128",
        width: 1.8,
        height: 48,
        displayValue: true,
        fontSize: 12
      });
      openModal('modal-barcode-print');
      lucide.createIcons();
    }

    let receiptPrintLocked = false;

    function printReceiptAutomatically() {
      if (receiptPrintLocked) return;
      if (!lastActiveTxForReceipt) {
        showToast('Data struk belum tersedia');
        return;
      }

      receiptPrintLocked = true;
      showToast('Menyiapkan printer struk...');

      setTimeout(() => {
        printCustomArea('thermal-receipt');
        setTimeout(() => {
          receiptPrintLocked = false;
        }, 1500);
      }, 150);
    }

    function printCustomArea(elementId) {
      const el = document.getElementById(elementId);
      if (!el) return window.print();
      document.querySelectorAll('.print-area').forEach(e => e.classList.remove('print-area'));
      el.classList.add('print-area');
      // Beri browser waktu menyelesaikan layout sebelum dialog printer USB dibuka.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.print();
        setTimeout(() => el.classList.remove('print-area'), 1200);
      }));
    }

    function cetakLaporanAktif() {
      if (activeLaporanTab === 'toko') printCustomArea('printable-laporan-toko');
      else printCustomArea('printable-laporan-brilink');
    }

    function toggleSelectProduct(id, checkbox) {
      if (checkbox.checked) selectedProductIds.add(id);
      else selectedProductIds.delete(id);
      updateBulkDeleteUI();
    }

    function toggleSelectAllProducts(masterCheckbox) {
      const search = (document.getElementById('filter-barang-search')?.value || '').toLowerCase();
      const kat = document.getElementById('filter-barang-kategori')?.value || 'semua';

      const visibleProducts = products.filter(p => {
        const matchSearch = p.nama.toLowerCase().includes(search) || p.kode.toLowerCase().includes(search) || (p.barcode && p.barcode.includes(search));
        const matchKat = kat === 'semua' || p.kategori === kat;
        const matchMenipis = !filterMenipisOnly || p.stok <= 5;
        return matchSearch && matchKat && matchMenipis;
      });

      if (masterCheckbox.checked) visibleProducts.forEach(p => selectedProductIds.add(p.id));
      else visibleProducts.forEach(p => selectedProductIds.delete(p.id));

      renderProductsTable();
      updateBulkDeleteUI();
    }

    function unselectAllProducts() {
      selectedProductIds.clear();
      const master = document.getElementById('select-all-products');
      if (master) master.checked = false;
      renderProductsTable();
      updateBulkDeleteUI();
    }

    function updateBulkDeleteUI() {
      const bar = document.getElementById('bulk-delete-bar');
      const countEl = document.getElementById('selected-product-count');
      const totalSelected = selectedProductIds.size;
      if (totalSelected > 0) {
        bar.classList.remove('hidden');
        countEl.innerText = totalSelected;
      } else {
        bar.classList.add('hidden');
      }
    }

    async function bulkDeleteSelectedProducts() {
      const total = selectedProductIds.size;
      if (total === 0 || !confirm(`Hapus ${total} barang terpilih?`)) return;

      for (const id of selectedProductIds) {
        if (!isFirebaseReady) products = products.filter(p => String(p.id) !== String(id));
        else await deleteFromCloud("products", id);
      }

      addLog('BULK_DELETE_PRODUCT', `Hapus massal ${total} barang`);
      selectedProductIds.clear();
      unselectAllProducts();
      renderProductsTable();
      renderPopupBarangList();
      showToast(`Sukses menghapus ${total} barang dari Cloud!`);
    }

    async function deleteProduct(id) {
      const prod = products.find(p => String(p.id) === String(id));
      if (!prod || !confirm(`Hapus barang "${prod.nama}" (${prod.kode})?`)) return;

      if (!isFirebaseReady) products = products.filter(p => String(p.id) !== String(id));
      else await deleteFromCloud("products", id);

      selectedProductIds.delete(id);
      addLog('DELETE_PRODUCT', `Hapus barang ${prod.nama}`);
      renderProductsTable();
      renderPopupBarangList();
      showToast(`Barang "${prod.nama}" dihapus dari Cloud`);
    }

    function toggleFilterMenipis() {
      filterMenipisOnly = !filterMenipisOnly;
      const btn = document.getElementById('btn-filter-menipis');
      if (filterMenipisOnly) btn.classList.add('bg-amber-100', 'text-amber-800', 'font-bold');
      else btn.classList.remove('bg-amber-100', 'text-amber-800', 'font-bold');
      renderProductsTable();
    }

    function handleExcelImport(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async function(evt) {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (jsonData.length === 0) return;

          let addedCount = 0;
          for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            const id = String(Date.now() + i);
            const kode = row['Kode'] || row['kode'] || 'P' + String(products.length + 1).padStart(3, '0');
            const barcode = row['Barcode'] || row['barcode'] || ('899' + Math.floor(1000000000 + Math.random() * 9000000000));
            const nama = row['Nama'] || row['nama'] || row['Nama Barang'] || 'Barang ' + (i + 1);
            const kategori = row['Kategori'] || row['kategori'] || 'Umum';
            const hModal = parseInt(row['Harga Modal'] || row['H. Modal'] || row['hModal'] || 0);
            const hJual = parseInt(row['Harga Eceran'] || row['Harga Jual'] || row['H. Jual'] || row['hJual'] || 0);
            let hGrosir = parseInt(row['Harga Grosir'] || row['H. Grosir'] || row['hGrosir'] || 0);
            if (!hGrosir || hGrosir >= hJual) hGrosir = Math.round(hJual * 0.9);
            const stok = parseInt(row['Stok'] || row['stok'] || 0);

            const prodData = { id, kode, barcode: String(barcode), nama, kategori, hModal, hJual, hGrosir, stok };
            if (!isFirebaseReady) products.push(prodData);
            else await syncToCloud("products", id, prodData);
            addedCount++;
          }

          renderProductsTable();
          renderPopupBarangList();
          addLog('IMPORT_XLSX', `Import ${addedCount} barang`);
          showToast(`Berhasil import ${addedCount} barang.`);
        } catch (err) {
          alert('Gagal membaca file Excel!');
        }
        e.target.value = '';
      };
      reader.readAsArrayBuffer(file);
    }

    function exportBarangExcel() {
      const dataToExport = products.map(p => ({
        'Kode': p.kode,
        'Barcode': p.barcode || '',
        'Nama Barang': p.nama,
        'Kategori': p.kategori,
        'Harga Modal': p.hModal,
        'Harga Eceran': p.hJual,
        'Harga Grosir': p.hGrosir || Math.round(p.hJual * 0.9),
        'Stok': p.stok
      }));
      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'DataBarang');
      XLSX.writeFile(workbook, 'Data_Barang_TokoBungEdi.xlsx');
      showToast('Data diexport ke format XLSX');
    }

    function openReceiptById(id) {
      const tx = transactions.find(t => String(t.id) === String(id));
      if (tx) showReceiptModal(tx);
    }

    function renderTransaksiTable() {
      const tbody = document.getElementById('table-transaksi-body');
      const search = (document.getElementById('filter-tx-search')?.value || '').toLowerCase();
      const filterDate = document.getElementById('filter-tx-date')?.value;
      const isAdmin = currentUser && currentUser.role === 'admin';

      let filtered = transactions.filter(t => {
        const matchSearch = t.id.toLowerCase().includes(search) || (t.kasir && t.kasir.toLowerCase().includes(search)) || (t.customerName && t.customerName.toLowerCase().includes(search));
        let matchDate = true;
        if (filterDate) matchDate = (t.dateKey === filterDate) || (t.waktu && t.waktu.includes(filterDate));
        return matchSearch && matchDate;
      });

      const totalPages = Math.max(1, Math.ceil(filtered.length / TRANSACTION_PAGE_SIZE));
      transactionPage = Math.min(Math.max(1, transactionPage), totalPages);
      const startIndex = (transactionPage - 1) * TRANSACTION_PAGE_SIZE;
      const pageRows = filtered.slice(startIndex, startIndex + TRANSACTION_PAGE_SIZE);

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">Belum ada riwayat transaksi</td></tr>`;
        renderTransactionPagination(0, 1);
        return;
      }

      tbody.innerHTML = pageRows.map(t => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900">${escapeHtml(t.id)}</td>
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${escapeHtml(t.waktu)}</td>
          <td class="px-4 sm:px-6 py-3">${escapeHtml(t.kasir)}</td>
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-800">${escapeHtml(t.customerName || 'Umum')}</td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">${escapeHtml(t.metode)}</span></td>
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-900">Rp${t.total.toLocaleString('id-ID')}</td>
          <td class="px-4 sm:px-6 py-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${t.status === 'SUKSES' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}">${escapeHtml(t.status)}</span>
          </td>
          <td class="px-4 sm:px-6 py-3 text-right space-x-1 whitespace-nowrap">
            <button onclick="openReceiptById('${escapeHtml(t.id)}')" title="Buka Struk" class="text-gray-400 hover:text-emerald-600 p-1"><i data-lucide="receipt" class="w-4 h-4"></i></button>
            ${isAdmin ? `
              <button onclick="openModalEditTx('${escapeHtml(t.id)}')" title="Edit Transaksi" class="text-gray-400 hover:text-blue-600 p-1"><i data-lucide="pencil" class="w-4 h-4"></i></button>
              <button onclick="deleteSingleTransaction('${escapeHtml(t.id)}')" title="Hapus Transaksi" class="text-gray-400 hover:text-red-600 p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            ` : ''}
          </td>
        </tr>
      `).join('');
      renderTransactionPagination(filtered.length, totalPages);
      lucide.createIcons();
    }

    function renderTransactionPagination(totalItems, totalPages) {
      const table = document.getElementById('table-transaksi-body');
      if (!table) return;
      const wrapper = table.closest('.bg-white');
      if (!wrapper) return;
      let el = document.getElementById('tx-pagination');
      if (!el) {
        el = document.createElement('div');
        el.id = 'tx-pagination';
        el.className = 'px-4 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs';
        wrapper.appendChild(el);
      }
      const totalPagesSafe = Math.max(1, totalPages);
      el.innerHTML = `
        <span class="text-gray-500">${totalItems} transaksi • halaman ${transactionPage} / ${totalPagesSafe}</span>
        <div class="flex gap-1">
          <button type="button" class="px-3 py-1.5 border rounded-lg ${transactionPage <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}" ${transactionPage <= 1 ? 'disabled' : ''} onclick="changeTransactionPage(-1)">‹ Sebelumnya</button>
          <button type="button" class="px-3 py-1.5 border rounded-lg ${transactionPage >= totalPagesSafe ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}" ${transactionPage >= totalPagesSafe ? 'disabled' : ''} onclick="changeTransactionPage(1)">Berikutnya ›</button>
        </div>`;
    }

    function changeTransactionPage(delta) {
      transactionPage += Number(delta) || 0;
      renderTransaksiTable();
    }

    function openModalEditTx(id) {
      const tx = transactions.find(t => t.id === id);
      if (!tx) return;
      document.getElementById('edit-tx-id').value = tx.id;
      document.getElementById('edit-tx-no').value = tx.id;
      document.getElementById('edit-tx-method').value = tx.metode;
      document.getElementById('edit-tx-status').value = tx.status;
      openModal('modal-edit-tx');
    }

    async function saveEditedTx(e) {
      e.preventDefault();
      const id = document.getElementById('edit-tx-id').value;
      const method = document.getElementById('edit-tx-method').value;
      const status = document.getElementById('edit-tx-status').value;
      try {
        if (isFirebaseReady) {
          const call = getCloudFunction('updateTransactionAtomic');
          if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
          await call({ id, metode: method, status, user: currentActorPayload() });
        } else {
          const tx = transactions.find(t => t.id === id);
          if (!tx) throw new Error('Transaksi tidak ditemukan.');
          tx.metode = method; tx.status = status;
        }
        addLog('UPDATE_TX', `Perbarui transaksi ${id}: ${status}`);
        clearExecutedForm('form-edit-tx'); closeModal('modal-edit-tx');
        renderTransaksiTable(); renderDashboard(); renderLaporan(); renderKasTable();
        showToast('Transaksi berhasil diperbarui.');
      } catch (err) {
        console.error('Update transaksi gagal:', err);
        showToast(err?.message || 'Gagal memperbarui transaksi.');
      }
    }

    async function deleteSingleTransaction(id) {
      const tx = transactions.find(t => t.id === id);
      if (!tx || !confirm(`Hapus transaksi "${id}"? Stok dan poin member akan dipulihkan secara atomic.`)) return;
      try {
        if (isFirebaseReady) {
          const call = getCloudFunction('deleteTransactionAtomic');
          if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
          await call({ id: String(id), user: currentActorPayload() });
        } else {
          for (const item of (tx.items || [])) {
            const prod = products.find(p => String(p.id) === String(item.id));
            if (prod) prod.stok = (Number(prod.stok)||0) + (Number(item.qty)||0);
          }
          if (tx.memberId) {
            const mem = members.find(m => String(m.id) === String(tx.memberId));
            if (mem) mem.poin = Math.max(0, (Number(mem.poin)||0) - Math.floor((Number(tx.total)||0)/10000));
          }
          transactions = transactions.filter(t => t.id !== id);
        }
        addLog('DELETE_TX', `Hapus transaksi ${id}`);
        renderTransaksiTable(); renderProductsTable(); renderDashboard(); renderLaporan(); renderKasTable();
        showToast(`Transaksi ${id} dihapus dan stok dipulihkan.`);
      } catch (err) {
        console.error('Delete transaksi gagal:', err);
        showToast(err?.message || 'Gagal menghapus transaksi.');
      }
    }

    async function resetAllTransactions() {
      if (!confirm('Hapus seluruh riwayat transaksi dan pulihkan stok setiap transaksi?')) return;
      const check = prompt('Ketik "RESET" untuk konfirmasi reset penuh:');
      if (check !== 'RESET') return;
      try {
        const list = [...transactions];
        if (isFirebaseReady) {
          for (const tx of list) {
            const call = getCloudFunction('deleteTransactionAtomic');
            if (!call) throw new Error('Cloud Functions SDK belum tersedia.');
            await call({ id: tx.id, user: currentActorPayload() });
          }
        } else {
          for (const tx of list) {
            for (const item of (tx.items || [])) {
              const prod = products.find(p => String(p.id) === String(item.id));
              if (prod) prod.stok = (Number(prod.stok)||0) + (Number(item.qty)||0);
            }
          }
          transactions = [];
        }
        addLog('RESET_TX', 'Semua riwayat transaksi di-reset dan stok dipulihkan');
        renderTransaksiTable(); renderDashboard(); renderLaporan(); renderKasTable(); renderProductsTable();
        showToast('Reset transaksi selesai.');
      } catch (err) {
        console.error('Reset transaksi gagal:', err);
        showToast(err?.message || 'Reset transaksi gagal.');
      }
    }

    async function hapusLaporanTanggalTertentu(targetDate) {
      if (!targetDate) {
        alert('Pilih tanggal laporan yang ingin dihapus terlebih dahulu.');
        return;
      }
      if (!confirm(`Hapus seluruh transaksi, pengeluaran & BRI link pada tanggal ${targetDate}?`)) return;

      const txToDelete = transactions.filter(t => t.dateKey === targetDate);
      for (const t of txToDelete) {
        if (!isFirebaseReady) transactions = transactions.filter(x => x.id !== t.id);
        else await deleteFromCloud("transactions", t.id);
      }

      const expToDelete = pengeluarans.filter(p => p.dateKey === targetDate);
      for (const p of expToDelete) {
        if (!isFirebaseReady) pengeluarans = pengeluarans.filter(x => x.id !== p.id);
        else await deleteFromCloud("pengeluarans", p.id);
      }

      const briToDelete = brilinks.filter(b => b.dateKey === targetDate);
      for (const b of briToDelete) {
        if (!isFirebaseReady) brilinks = brilinks.filter(x => x.id !== b.id);
        else await deleteFromCloud("brilinks", b.id);
      }

      // Hapus pemasukan dan retur pada tanggal yang sama agar laporan benar-benar bersih.
      const incToDelete = pemasukans.filter(p => p.dateKey === targetDate);
      for (const p of incToDelete) {
        if (!isFirebaseReady) pemasukans = pemasukans.filter(x => x.id !== p.id);
        else await deleteFromCloud("pemasukans", p.id);
      }

      const returToDelete = returs.filter(r => r.dateKey === targetDate);
      for (const r of returToDelete) {
        if (r.expenseId) await deleteFromCloud("pengeluarans", r.expenseId);
        if (r.incomeId) await deleteFromCloud("pemasukans", r.incomeId);
        if (r.stokLogId) await deleteFromCloud("stokLogs", r.stokLogId);
        if (!isFirebaseReady) {
          pengeluarans = pengeluarans.filter(x => x.id !== r.expenseId);
          pemasukans = pemasukans.filter(x => x.id !== r.incomeId);
          stokLogs = stokLogs.filter(x => x.id !== r.stokLogId);
          returs = returs.filter(x => x.id !== r.id);
        } else {
          await deleteFromCloud("returs", r.id);
        }
      }

      renderTransaksiTable();
      renderKasTable();
      renderBriLinkTable();
      renderDashboard();
      renderLaporan();

      addLog('DELETE_DAILY_REPORT', `Hapus laporan tanggal ${targetDate}`);
      showToast(`Data laporan tanggal ${targetDate} berhasil dibersihkan dari Cloud!`);
    }

    function exportLaporanExcelAktif() {
      if (activeLaporanTab === 'toko') exportLaporanTokoExcel();
      else exportLaporanBriLinkExcel();
    }

    function exportLaporanTokoExcel() {
      const period = getLaporanPeriod();
      const validTx = transactions.filter(t => t.status !== 'DIBATALKAN');
      const rows = [];
      const totalDays = new Date(period.year, period.month, 0).getDate();

      for (let day = 1; day <= totalDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const isoDate = `${period.value}-${dayStr}`;
        const simpleDate = `${dayStr}/${String(period.month).padStart(2, '0')}/${period.year}`;

        const dayTx = validTx.filter(t => t.dateKey === isoDate);
        const sVal = dayTx.reduce((acc, t) => acc + (Number(t.total) || 0), 0);
        const lVal = dayTx.reduce((acc, t) => acc + (Number(t.profit) || 0), 0);

        const dayExp = pengeluarans.filter(p =>
          p.dateKey === isoDate && (!p.expenseType || p.expenseType === 'toko')
        );
        const eVal = dayExp.reduce((acc, p) => acc + (Number(p.nominal) || 0), 0);

        const dayInc = pemasukans.filter(p =>
          p.dateKey === isoDate && p.source !== 'retur'
        );
        const iVal = dayInc.reduce((acc, p) => acc + (Number(p.nominal) || 0), 0);

        const dayReturSupplier = returs.filter(r =>
          r.dateKey === isoDate && r.type === 'supplier'
        ).reduce((acc, r) => acc + (Number(r.nilai) || 0), 0);

        const dayRefund = returs.filter(r =>
          r.dateKey === isoDate && r.type === 'pelanggan'
        ).reduce((acc, r) => acc + (Number(r.nilai) || 0), 0);

        rows.push({
          'Tanggal': simpleDate,
          'Penjualan Toko': sVal,
          'Laba Kotor': lVal,
          'Pemasukan Lain': iVal,
          'Retur Supplier / Pengembalian': dayReturSupplier,
          'Pengeluaran Toko': eVal,
          'Refund Retur Pelanggan': dayRefund,
          'Hasil Bersih': (lVal + iVal + dayReturSupplier - eVal - dayRefund)
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan_Toko_Lengkap');
      XLSX.writeFile(workbook, 'Laporan_Toko_Lengkap.xlsx');
      showToast('Laporan Toko lengkap berhasil diexport ke Excel');
    }

    function exportLaporanBriLinkExcel() {
      const period = getLaporanPeriod();
      const rows = [];
      const totalDays = new Date(period.year, period.month, 0).getDate();
      for (let day = 1; day <= totalDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const isoDate = `${period.value}-${dayStr}`;
        const simpleDate = `${dayStr}/${String(period.month).padStart(2, '0')}/${period.year}`;

        const dayBri = brilinks.filter(b => b.dateKey === isoDate);
        const bVol = dayBri.reduce((acc, b) => acc + (b.nominal || 0), 0);
        const bFee = dayBri.reduce((acc, b) => acc + (b.fee || 0), 0);
        const bProfit = dayBri.reduce((acc, b) => acc + (b.profit || 0), 0);
        const bExp = pengeluarans.filter(p => p.dateKey === isoDate && p.expenseType === 'brilink').reduce((acc, p) => acc + (p.nominal || 0), 0);

        rows.push({
          'Tanggal': simpleDate,
          'Volume Perputaran': bVol,
          'Fee Admin': bFee,
          'Pengeluaran BRI Link': bExp,
          'Laba Bersih Agen': (bProfit - bExp),
          'Jumlah Tx': dayBri.length
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan_BRILink');
      XLSX.writeFile(workbook, 'Laporan_BRILink_Terpadu.xlsx');
      showToast('Laporan BRI Link diexport ke Excel');
    }


    function applyStoreInfo() {
      document.title = storeInfo.name + (isFirebaseReady ? ' - POS Cloud Admin' : ' - POS Kasir Offline');
      document.querySelectorAll('h1,h2,.classic-pos-title').forEach(el => { if (el.textContent.trim() === 'TOKO BUNG EDI') el.textContent = storeInfo.name; });
      const a=document.getElementById('store-address-display'); if(a) a.textContent=storeInfo.address;
      const ph=document.getElementById('store-phone-display'); if(ph) ph.textContent='No HP / WA: '+storeInfo.phone;
      const n=document.getElementById('store-name-input'); if(n) n.value=storeInfo.name;
      const ad=document.getElementById('store-address-input'); if(ad) ad.value=storeInfo.address;
      const p=document.getElementById('store-phone-input'); if(p) p.value=storeInfo.phone;
    }
    async function saveStoreSettings(e) {
      e.preventDefault();
      storeInfo = {
        name: document.getElementById('store-name-input').value.trim(),
        address: document.getElementById('store-address-input').value.trim(),
        phone: document.getElementById('store-phone-input').value.trim()
      };
      applyStoreInfo();
      if (isFirebaseReady && db) {
        try {
          await db.collection('storeSettings').doc('main').set(storeInfo, { merge: true });
          showToast('Informasi toko berhasil disimpan ke cloud');
        } catch (err) {
          console.error('Gagal menyimpan pengaturan toko:', err);
          showToast('Gagal menyimpan ke cloud. Periksa aturan Firestore.');
        }
      } else {
        showToast('Informasi toko tersimpan sementara di perangkat');
      }
    }
    function openModalUser() { openModal('modal-user'); }

    async function saveNewUser(e) {
      e.preventDefault();
      const nama = document.getElementById('user-fullname').value.trim();
      const username = document.getElementById('user-newusername').value.trim().toLowerCase();
      const password = document.getElementById('user-newpassword').value;
      const role = document.getElementById('user-role-select').value.toUpperCase();

      const now = new Date();
      const timeStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
      const passwordHash = await hashPassword(password);
      const uEntry = { id: String(Date.now()), nama, username, passwordHash, role, status: 'AKTIF', dibuat: timeStr };
      
      if (!isFirebaseReady) appUsers.push(uEntry);
      else await syncToCloud("appUsers", uEntry.id, uEntry);

      addLog('CREATE_USER', `Tambah user ${nama} (${role})`);
      closeModal('modal-user');
      renderUsersTable();
      clearExecutedForm('form-user');
      showToast(isFirebaseReady ? 'User berhasil didaftarkan di Cloud.' : 'User berhasil didaftarkan di perangkat.');
    }

    async function deleteUser(id) {
      if (appUsers.length <= 1) {
        alert('Minimal harus ada satu user akun tersisa!');
        return;
      }
      if (!confirm('Hapus pengguna ini?')) return;
      if (!isFirebaseReady) appUsers = appUsers.filter(u => u.id !== id);
      else await deleteFromCloud("appUsers", id);
      renderUsersTable();
      showToast('Pengguna dihapus');
    }

    function renderUsersTable() {
      const tbody = document.getElementById('table-users-body');
      tbody.innerHTML = appUsers.map(u => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 font-bold text-gray-900">${u.nama}</td>
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-700">${u.username || '-'}</td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.role === 'ADMIN' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}">${u.role}</span></td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">${u.status}</span></td>
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${u.dibuat}</td>
          <td class="px-4 sm:px-6 py-3 text-right">
            <button onclick="deleteUser('${u.id}')" class="text-gray-400 hover:text-red-600 p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    function renderAktivitas() {
      const tbody = document.getElementById('table-aktivitas-body');
      const search = (document.getElementById('filter-aktivitas-search')?.value || '').toLowerCase();
      const filtered = aktivitasLogs.filter(l => l.user.toLowerCase().includes(search) || l.action.toLowerCase().includes(search) || l.detail.toLowerCase().includes(search));

      tbody.innerHTML = filtered.map(log => `
        <tr class="hover:bg-gray-50/60 transition">
          <td class="px-4 sm:px-6 py-3 text-gray-500 whitespace-nowrap">${log.waktu}</td>
          <td class="px-4 sm:px-6 py-3 font-semibold text-gray-900">${escapeHtml(log.user)}</td>
          <td class="px-4 sm:px-6 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${log.tag}">${escapeHtml(log.action)}</span></td>
          <td class="px-4 sm:px-6 py-3 text-gray-600">${escapeHtml(log.detail)}</td>
        </tr>
      `).join('');
    }

    window.addEventListener('DOMContentLoaded', async () => {
      lucide.createIcons();
      setCloudStatus(false);
      localStateReady = loadLocalState();
      await localStateReady;
      initializeDateFilters();
      renderKasirCategoryPills();
      renderKasirCatalog();
      renderKasirMemberDropdown();
      renderProductsTable();
      renderMemberTable();
      renderStokTable();
      renderTransaksiTable();
      renderReturTable();
      renderKasTable();
      renderBriLinkTable();
      renderUsersTable();
      renderAktivitas();
      renderDashboard();
      renderLaporan();
    });

    // Setiap interaksi pengguna menjadwalkan snapshot lokal; ini membuat
    // perubahan tetap ada setelah refresh tanpa membebani IndexedDB terus-menerus.
    document.addEventListener('click', () => scheduleLocalPersist(), true);
    document.addEventListener('change', () => scheduleLocalPersist(), true);
    document.addEventListener('input', () => scheduleLocalPersist(600), true);
    document.addEventListener('keydown', () => scheduleLocalPersist(800), true);
    window.addEventListener('pagehide', () => {
      try { localStorage.setItem('tbe-local-emergency', JSON.stringify(getLocalStateSnapshot())); } catch (_) {}
    });
  
    document.addEventListener('keydown', function (event) {
      const checkoutModal = document.getElementById('modal-checkout');
      const receiptModal = document.getElementById('modal-receipt');
      const checkoutOpen = checkoutModal && !checkoutModal.classList.contains('hidden');
      const receiptOpen = receiptModal && !receiptModal.classList.contains('hidden');

      if (receiptOpen) {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          printReceiptAutomatically();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeModal('modal-receipt');
          focusKasirSearch();
          return;
        }
      }

      if (checkoutOpen && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        confirmCheckout();
        return;
      }

      if (!checkoutOpen && !receiptOpen && event.key === 'F9') {
        event.preventDefault();
        openCheckoutModal();
        return;
      }

      if (!checkoutOpen && !receiptOpen && event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        openCheckoutModal();
      }
    }, true);
