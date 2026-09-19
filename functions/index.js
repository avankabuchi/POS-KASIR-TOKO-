const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const REGION = 'asia-southeast1';
const TIME_ZONE = 'Asia/Jakarta';
const DELETE_BATCH_SIZE = 400;

function jakartaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeStr: `${parts.day} ${new Intl.DateTimeFormat('id-ID', { timeZone: TIME_ZONE, month: 'short' }).format(date)} ${parts.year}, ${parts.hour}.${parts.minute} WIB`,
  };
}

function requirePayload(data) {
  if (!data || typeof data !== 'object') throw new HttpsError('invalid-argument', 'Payload tidak valid.');
}

function actor(data) {
  const user = data.user || {};
  return {
    name: String(user.name || user.nama || 'User'),
    username: String(user.username || ''),
    role: String(user.role || 'kasir').toLowerCase(),
  };
}

function positiveInt(value, label) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) throw new HttpsError('invalid-argument', `${label} harus lebih dari 0.`);
  return n;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpsError('invalid-argument', 'Nilai uang tidak valid.');
  return Math.round(n);
}

function priceForProduct(product, mode) {
  if (mode === 'grosir') return Number(product.hGrosir ?? product.hJual ?? 0);
  return Number(product.hJual ?? 0);
}

function makeStockLogId(prefix = 'STK') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

exports.createSale = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const data = request.data;
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) throw new HttpsError('invalid-argument', 'Keranjang kosong.');

  const operationId = String(data.operationId || '');
  if (!operationId || operationId.length > 120) throw new HttpsError('invalid-argument', 'operationId wajib diisi.');

  const actorInfo = actor(data);
  const payment = money(data.bayar);
  const metode = String(data.metode || 'CASH');
  const memberId = String(data.memberId || '');
  const operationRef = db.collection('operationLocks').doc(operationId);
  const nowMs = Date.now();
  const { dateKey, timeStr } = jakartaDateParts();
  const counterRef = db.collection('counters').doc(`transactions_${dateKey}`);

  const result = await db.runTransaction(async (tx) => {
    const existingLock = await tx.get(operationRef);
    if (existingLock.exists) {
      const lock = existingLock.data() || {};
      if (lock.type === 'SALE' && lock.transactionId) {
        const existingTx = await tx.get(db.collection('transactions').doc(lock.transactionId));
        if (existingTx.exists) return { duplicate: true, transaction: { id: existingTx.id, ...existingTx.data() } };
      }
      throw new HttpsError('already-exists', 'Operasi checkout sudah pernah diproses.');
    }

    const productRefs = [];
    const productSnaps = [];
    const seen = new Set();
    for (const raw of items) {
      const id = String(raw.id || '');
      if (!id || seen.has(id)) throw new HttpsError('invalid-argument', 'Item transaksi tidak valid atau duplikat.');
      seen.add(id);
      const qty = positiveInt(raw.qty, `Qty ${id}`);
      const ref = db.collection('products').doc(id);
      productRefs.push({ ref, id, qty, raw });
    }
    for (const p of productRefs) productSnaps.push(await tx.get(p.ref));

    // IMPORTANT: Firestore transactions must complete all reads before any writes.
    const memberRef = memberId ? db.collection('members').doc(memberId) : null;
    const memberSnap = memberRef ? await tx.get(memberRef) : null;
    const counterSnap = await tx.get(counterRef);

    let total = 0;
    let totalModal = 0;
    const finalItems = [];
    const stockLogs = [];

    productRefs.forEach((p, index) => {
      const snap = productSnaps[index];
      if (!snap.exists) throw new HttpsError('not-found', `Produk ${p.id} tidak ditemukan.`);
      const product = snap.data() || {};
      const stok = Number(product.stok) || 0;
      if (stok < p.qty) throw new HttpsError('failed-precondition', `Stok ${product.nama || p.id} tidak mencukupi. Stok tersedia: ${stok}.`);

      const priceMode = p.raw.priceMode === 'grosir' ? 'grosir' : 'eceran';
      const unitPrice = money(priceForProduct(product, priceMode));
      const modal = Math.max(0, Number(product.hModal) || 0);
      const subtotal = unitPrice * p.qty;
      total += subtotal;
      totalModal += modal * p.qty;
      finalItems.push({
        id: p.id,
        kode: String(product.kode || ''),
        barcode: String(product.barcode || ''),
        nama: String(product.nama || p.raw.nama || p.id),
        kategori: String(product.kategori || ''),
        hModal: modal,
        hJual: Number(product.hJual) || 0,
        hGrosir: Number(product.hGrosir) || 0,
        qty: p.qty,
        priceMode,
        currentPrice: unitPrice,
      });
      const setelah = stok - p.qty;
      tx.update(p.ref, { stok: setelah, updatedAt: FieldValue.serverTimestamp() });
      stockLogs.push({
        ref: db.collection('stokLogs').doc(makeStockLogId('STK-SALE')),
        data: {
          timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
          barang: String(product.nama || p.id), barangId: p.id, tipe: 'SALE', qty: -p.qty,
          sebelum: stok, setelah, user: actorInfo.name, username: actorInfo.username, operationId,
        },
      });
    });

    if (payment < total) throw new HttpsError('failed-precondition', `Pembayaran kurang Rp${(total - payment).toLocaleString('id-ID')}.`);

    let customerName = 'Umum';
    let customerPhone = '';
    if (memberId && memberSnap && memberSnap.exists) {
      const member = memberSnap.data() || {};
      customerName = String(member.nama || 'Umum');
      customerPhone = String(member.phone || '');
      tx.update(memberRef, { poin: (Number(member.poin) || 0) + Math.floor(total / 10000), updatedAt: FieldValue.serverTimestamp() });
    }

    const nextNumber = (counterSnap.exists ? Number(counterSnap.data().value) || 0 : 0) + 1;
    tx.set(counterRef, { value: nextNumber, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const txNumber = `TRX-${dateKey.replace(/-/g, '')}-${String(nextNumber).padStart(4, '0')}`;
    const totalProfit = total - totalModal;
    const txData = {
      id: txNumber, timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
      kasir: actorInfo.name, kasirUsername: actorInfo.username, customerName, customerPhone,
      memberId: memberId || '', metode, bayar: payment, kembali: payment - total, total,
      profit: totalProfit, status: 'SUKSES', items: finalItems, operationId,
    };
    const transactionRef = db.collection('transactions').doc(txNumber);
    tx.create(transactionRef, txData);
    for (const log of stockLogs) tx.create(log.ref, log.data);
    tx.create(operationRef, { type: 'SALE', transactionId: txNumber, createdAt: FieldValue.serverTimestamp() });

    return { duplicate: false, transaction: { ...txData, createdAt: null } };
  });

  return result;
});

exports.createReturn = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const data = request.data;
  const operationId = String(data.operationId || '');
  if (!operationId) throw new HttpsError('invalid-argument', 'operationId wajib diisi.');
  const type = String(data.type || '').toLowerCase();
  const priceType = String(data.priceType || 'eceran').toLowerCase();
  if (!['pelanggan', 'supplier'].includes(type)) throw new HttpsError('invalid-argument', 'Jenis retur tidak valid.');
  if (!['barang', 'modal', 'eceran', 'grosir'].includes(priceType)) throw new HttpsError('invalid-argument', 'Jenis harga retur tidak valid.');
  const productId = String(data.productId || '');
  const qty = positiveInt(data.qty, 'Qty retur');
  const alasan = String(data.alasan || '').trim();
  if (!productId || !alasan) throw new HttpsError('invalid-argument', 'Barang dan alasan retur wajib diisi.');
  const actorInfo = actor(data);
  const { dateKey, timeStr } = jakartaDateParts();
  const nowMs = Date.now();
  const operationRef = db.collection('operationLocks').doc(operationId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(operationRef);
    if (existing.exists) {
      const lock = existing.data() || {};
      if (lock.type === 'RETURN' && lock.returnId) {
        const old = await tx.get(db.collection('returs').doc(lock.returnId));
        if (old.exists) return { duplicate: true, retur: { id: old.id, ...old.data() } };
      }
      throw new HttpsError('already-exists', 'Operasi retur sudah pernah diproses.');
    }

    const productRef = db.collection('products').doc(productId);
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists) throw new HttpsError('not-found', 'Barang retur tidak ditemukan.');
    const product = productSnap.data() || {};
    const stokSebelum = Number(product.stok) || 0;
    let stokSesudah = stokSebelum;
    if (priceType !== 'barang') {
      if (type === 'pelanggan') stokSesudah += qty;
      else {
        if (qty > stokSebelum) throw new HttpsError('failed-precondition', `Stok tidak cukup untuk retur supplier. Stok: ${stokSebelum}.`);
        stokSesudah -= qty;
      }
    }

    const unitPrice = priceType === 'modal' ? Number(product.hModal) || 0 : priceType === 'grosir' ? Number(product.hGrosir ?? product.hJual) || 0 : Number(product.hJual) || 0;
    const totalNilai = Math.round(unitPrice * qty);
    const returId = `RET-${dateKey.replace(/-/g, '')}-${String(nowMs).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const stokLogId = makeStockLogId('STK-RET');
    const returRef = db.collection('returs').doc(returId);
    const stokRef = db.collection('stokLogs').doc(stokLogId);

    const returData = {
      id: returId, timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), type, dateKey, waktu: timeStr,
      barangId: productId, barangNama: String(product.nama || productId), qty, priceType,
      detail: `${product.nama || productId} (${qty}x @Rp${unitPrice.toLocaleString('id-ID')}) - ${alasan}`,
      nilai: totalNilai, user: actorInfo.name, username: actorInfo.username,
      stokSebelum, stokSesudah, stokLogId, operationId,
    };
    const stokData = {
      id: stokLogId, timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
      barang: String(product.nama || productId), barangId: productId,
      tipe: type === 'pelanggan' ? 'RETURN_IN' : 'RETURN_OUT', qty: type === 'pelanggan' ? qty : -qty,
      sebelum: stokSebelum, setelah: stokSesudah, user: actorInfo.name, username: actorInfo.username, operationId,
    };

    if (priceType !== 'barang') tx.update(productRef, { stok: stokSesudah, updatedAt: FieldValue.serverTimestamp() });
    tx.create(stokRef, stokData);

    if (type === 'pelanggan' && priceType !== 'barang') {
      const expId = `EXP-RET-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const expRef = db.collection('pengeluarans').doc(expId);
      tx.create(expRef, {
        id: expId, expenseType: 'toko', jenisPengeluaran: 'toko', dateKey, tanggal: timeStr,
        kategori: 'Refund Retur Pelanggan', metode: 'CASH', nominal: totalNilai,
        catatan: `Barang: ${product.nama || productId} (${qty}x) - ${alasan}`, source: 'retur', returId: returId,
        timestamp: nowMs, createdAt: FieldValue.serverTimestamp(),
      });
      returData.expenseId = expId;
    }
    if (type === 'supplier' && priceType !== 'barang') {
      const incId = `IN-RET-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const incRef = db.collection('pemasukans').doc(incId);
      tx.create(incRef, {
        id: incId, timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), dateKey, tanggal: timeStr,
        kategori: 'Pengembalian Retur Supplier', metode: 'CASH', nominal: totalNilai,
        catatan: `Barang: ${product.nama || productId} (${qty}x) - ${alasan}`, source: 'retur', returId: returId,
      });
      returData.incomeId = incId;
    }

    tx.create(returRef, returData);
    tx.create(operationRef, { type: 'RETURN', returnId: returId, createdAt: FieldValue.serverTimestamp() });
    return { duplicate: false, retur: { ...returData, createdAt: null } };
  });
});

exports.deleteTransactionAtomic = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const id = String(request.data.id || '');
  if (!id) throw new HttpsError('invalid-argument', 'ID transaksi wajib diisi.');
  const ref = db.collection('transactions').doc(id);
  const { dateKey, timeStr } = jakartaDateParts();
  const actorInfo = actor(request.data);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { deleted: false, message: 'Transaksi sudah tidak ada.' };
    const data = snap.data() || {};
    if (data.status === 'DIBATALKAN') {
      tx.delete(ref);
      return { deleted: true, alreadyCancelled: true };
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const productReads = [];
    for (const item of items) {
      const pRef = db.collection('products').doc(String(item.id));
      productReads.push({ item, ref: pRef, snap: await tx.get(pRef) });
    }
    const memberRef = data.memberId ? db.collection('members').doc(String(data.memberId)) : null;
    const memberSnap = memberRef ? await tx.get(memberRef) : null;

    // All reads are complete above; writes begin here.
    for (const { item, ref: pRef, snap: pSnap } of productReads) {
      if (!pSnap.exists) continue;
      const p = pSnap.data() || {};
      const before = Number(p.stok) || 0;
      const qty = positiveInt(item.qty, 'Qty transaksi');
      const after = before + qty;
      tx.update(pRef, { stok: after, updatedAt: FieldValue.serverTimestamp() });
      const logRef = db.collection('stokLogs').doc(makeStockLogId('STK-VOID'));
      tx.create(logRef, {
        id: logRef.id, timestamp: Date.now(), createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
        barang: String(p.nama || item.nama || item.id), barangId: String(item.id), tipe: 'VOID_SALE', qty,
        sebelum: before, setelah: after, user: actorInfo.name, username: actorInfo.username, sourceTransactionId: id,
      });
    }
    if (memberRef && memberSnap && memberSnap.exists) {
      const m = memberSnap.data() || {};
      tx.update(memberRef, { poin: Math.max(0, (Number(m.poin) || 0) - Math.floor((Number(data.total) || 0) / 10000)), updatedAt: FieldValue.serverTimestamp() });
    }
    tx.delete(ref);
    return { deleted: true };
  });
});

exports.updateTransactionAtomic = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const id = String(request.data.id || '');
  const method = String(request.data.metode || 'CASH');
  const requestedStatus = String(request.data.status || 'SUKSES').toUpperCase();
  if (!id || !['SUKSES', 'DIBATALKAN'].includes(requestedStatus)) throw new HttpsError('invalid-argument', 'Data transaksi tidak valid.');
  const ref = db.collection('transactions').doc(id);
  const actorInfo = actor(request.data);
  const { dateKey, timeStr } = jakartaDateParts();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Transaksi tidak ditemukan.');
    const data = snap.data() || {};
    const oldStatus = String(data.status || 'SUKSES').toUpperCase();
    if (oldStatus === requestedStatus) {
      tx.update(ref, { metode: method, updatedAt: FieldValue.serverTimestamp() });
      return { changed: false, transaction: { id, ...data, metode: method, status: oldStatus } };
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const direction = requestedStatus === 'DIBATALKAN' ? 1 : -1;
    const productReads = [];
    for (const item of items) {
      const pRef = db.collection('products').doc(String(item.id));
      const pSnap = await tx.get(pRef);
      productReads.push({ item, ref: pRef, snap: pSnap });
    }
    const memberRef = data.memberId ? db.collection('members').doc(String(data.memberId)) : null;
    const memberSnap = memberRef ? await tx.get(memberRef) : null;

    // All reads are complete above; writes begin here.
    for (const { item, ref: pRef, snap: pSnap } of productReads) {
      if (!pSnap.exists) throw new HttpsError('not-found', `Produk ${item.id} pada transaksi tidak ditemukan.`);
      const p = pSnap.data() || {};
      const before = Number(p.stok) || 0;
      const qty = positiveInt(item.qty, 'Qty transaksi');
      const after = before + direction * qty;
      if (after < 0) throw new HttpsError('failed-precondition', `Stok ${p.nama || item.id} tidak cukup untuk mengaktifkan kembali transaksi.`);
      tx.update(pRef, { stok: after, updatedAt: FieldValue.serverTimestamp() });
      const logRef = db.collection('stokLogs').doc(makeStockLogId(direction > 0 ? 'STK-CANCEL' : 'STK-RESTORE'));
      tx.create(logRef, {
        id: logRef.id, timestamp: Date.now(), createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
        barang: String(p.nama || item.nama || item.id), barangId: String(item.id),
        tipe: direction > 0 ? 'CANCEL_SALE' : 'RESTORE_SALE', qty: direction * qty,
        sebelum: before, setelah: after, user: actorInfo.name, username: actorInfo.username, sourceTransactionId: id,
      });
    }
    if (memberRef && memberSnap && memberSnap.exists) {
      const m = memberSnap.data() || {};
      const points = Math.floor((Number(data.total) || 0) / 10000);
      tx.update(memberRef, { poin: Math.max(0, (Number(m.poin) || 0) + direction * points), updatedAt: FieldValue.serverTimestamp() });
    }
    const newData = { metode: method, status: requestedStatus, updatedAt: FieldValue.serverTimestamp() };
    tx.update(ref, newData);
    return { changed: true, transaction: { id, ...data, ...newData, updatedAt: null } };
  });
});

exports.applyStockMovementAtomic = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const data = request.data;
  const mode = String(data.mode || 'tambah');
  const productId = String(data.productId || '');
  const qtyInput = positiveInt(data.qty, 'Jumlah stok');
  if (!productId || !['tambah', 'kurang', 'opname'].includes(mode)) throw new HttpsError('invalid-argument', 'Data mutasi stok tidak valid.');
  const ref = db.collection('products').doc(productId);
  const actorInfo = actor(data);
  const { dateKey, timeStr } = jakartaDateParts();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Produk tidak ditemukan.');
    const p = snap.data() || {};
    const before = Number(p.stok) || 0;
    let after;
    let delta;
    let tipe;
    if (mode === 'tambah') { after = before + qtyInput; delta = qtyInput; tipe = 'RESTOCK'; }
    else if (mode === 'kurang') { if (qtyInput > before) throw new HttpsError('failed-precondition', `Stok tidak cukup. Stok saat ini ${before}.`); after = before - qtyInput; delta = -qtyInput; tipe = 'STOCK_OUT'; }
    else { after = qtyInput; delta = after - before; tipe = 'ADJUSTMENT'; }
    tx.update(ref, { stok: after, updatedAt: FieldValue.serverTimestamp() });
    const logRef = db.collection('stokLogs').doc(`STK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tx.create(logRef, {
      id: logRef.id, timestamp: Date.now(), createdAt: FieldValue.serverTimestamp(), dateKey, waktu: timeStr,
      barang: String(p.nama || productId), barangId: productId, tipe, qty: delta,
      sebelum: before, setelah: after, user: actorInfo.name, username: actorInfo.username,
    });
    return { after, delta, tipe, logId: logRef.id };
  });
});

exports.deleteReturnAtomic = onCall({ region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  requirePayload(request.data);
  const id = String(request.data.id || '');
  if (!id) throw new HttpsError('invalid-argument', 'ID retur wajib diisi.');
  const ref = db.collection('returs').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { deleted: false };
    const r = snap.data() || {};
    const productRef = db.collection('products').doc(String(r.barangId));
    const productSnap = await tx.get(productRef);
    if (productSnap.exists && r.priceType !== 'barang') {
      const p = productSnap.data() || {};
      const before = Number(p.stok) || 0;
      const qty = positiveInt(r.qty, 'Qty retur');
      const after = r.type === 'pelanggan' ? before - qty : before + qty;
      if (after < 0) throw new HttpsError('failed-precondition', 'Retur pelanggan tidak dapat dibatalkan karena stok tidak mencukupi.');
      tx.update(productRef, { stok: after, updatedAt: FieldValue.serverTimestamp() });
    }
    if (r.expenseId) tx.delete(db.collection('pengeluarans').doc(String(r.expenseId)));
    if (r.incomeId) tx.delete(db.collection('pemasukans').doc(String(r.incomeId)));
    if (r.stokLogId) tx.delete(db.collection('stokLogs').doc(String(r.stokLogId)));
    tx.delete(ref);
    return { deleted: true };
  });
});

exports.cleanupOldTransactions = onSchedule({
  schedule: '0 2 * * *', timeZone: TIME_ZONE, region: REGION,
  timeoutSeconds: 540, memory: '256MiB', retryCount: 1,
}, async () => {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffMs = cutoff.getTime();
  let totalDeleted = 0;
  while (true) {
    const snapshot = await db.collection('transactions')
      .where('timestamp', '<=', cutoffMs).limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snapshot.size;
    if (snapshot.size < DELETE_BATCH_SIZE) break;
  }
  logger.info('Pembersihan transaksi selesai', { deleted: totalDeleted, cutoff: cutoff.toISOString() });
});
