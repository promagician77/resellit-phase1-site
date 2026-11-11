// ReSellit-side connector (drop-in, no dependencies). Add to the ReSellit page that shows a draft:
//   <meta name="resellit-lister" content="1">
//   <script src="resellit-lister.js"></script>
// Then:
//   await ReSellitLister.available()                 -> { version } or null if the extension is missing
//   await ReSellitLister.send(draft, 'poshmark')     -> { action: 'opened' | 'focused' | 'blocked' | 'check' | 'invalid', record }
//   ReSellitLister.onUpdate(async (key, record) => { await saveToReSellit(record) })  // acked after your handler resolves
//   await ReSellitLister.check(draft.id, 'poshmark') -> looks the item up on the marketplace by SKU
//   await ReSellitLister.link(draft.id, 'poshmark', url) -> manual link if the seller pastes it
// ReSellit stores only `record.state`, `record.url`, `record.listingId` next to the item. Inventory fields are never sent back.
(function () {
  const pending = new Map();
  const listeners = [];
  let seq = 0;
  window.addEventListener('message', async e => {
    if (e.source !== window || e.data?.source !== 'resellit-ext') return;
    const msg = e.data;
    if (msg.reqId && pending.has(msg.reqId)) { pending.get(msg.reqId)(msg); pending.delete(msg.reqId); return; }
    if (msg.type === 'RECORD_UPDATE') {
      try { for (const fn of listeners) await fn(msg.key, msg.record); post({ type: 'ACK', msgId: msg.msgId }); }
      catch (err) { console.warn('[ReSellitLister] update not saved; will be re-delivered', err); }
    }
  });
  const post = m => window.postMessage({ ...m, source: 'resellit-app' }, location.origin);
  const call = (type, data = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const reqId = `r${Date.now()}-${++seq}`;
    const t = setTimeout(() => { pending.delete(reqId); reject(new Error(`${type}: no answer from the extension`)); }, timeout);
    pending.set(reqId, m => { clearTimeout(t); resolve(m); });
    post({ type, reqId, ...data });
  });
  window.ReSellitLister = {
    available: async () => { // the bridge may load a moment after the page: retry briefly
      for (let i = 0; i < 6; i++) {
        const m = await call('HELLO', {}, 350).catch(() => null);
        if (m) return { version: m.version, markets: m.markets };
      }
      return null;
    },
    send: (draft, market = 'poshmark', opts = {}) => call('SEND', { draft, market, target: opts.target || 'live', origin: location.origin, variant: opts.variant }),
    check: (resellitId, market = 'poshmark', opts = {}) => call('CHECK', { resellitId, market, target: opts.target || 'live', origin: location.origin }),
    link: (resellitId, market, url) => call('LINK', { resellitId, market, url }),
    records: () => call('RECORDS').then(m => m.records),
    patchAdapter: patch => call('PATCH_ADAPTER', { patch }),
    reset: () => call('RESET'),
    onUpdate: fn => listeners.push(fn)
  };
})();
