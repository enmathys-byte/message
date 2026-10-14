(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.KURZ_CONFIG || {};
  const base = (config.apiUrl || '').replace(/\/$/, '');
  const adminName = config.adminName || 'Nicola';
  const state = { messages: new Map(), token: '', reply: null, loading: false, initial: false, hasOlder: false, busy: false, requestId: null, version: '' };
  const timeFormat = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
  const dayKey = value => new Date(value).toLocaleDateString('sv-SE');
  document.querySelectorAll('[data-admin-name]').forEach(el => { el.textContent = adminName; });
  try { $('author').value = localStorage.getItem('kurz-name') || ''; state.token = sessionStorage.getItem('kurz-session') || ''; } catch { /* Storage can be disabled. */ }

  function connection(label, status) { $('connection-label').textContent = label; $('connection').dataset.state = status; }
  function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
  function setSession(token) {
    state.token = token;
    try { token ? sessionStorage.setItem('kurz-session', token) : sessionStorage.removeItem('kurz-session'); } catch {}
    $('admin-button-label').textContent = token ? 'Abmelden' : 'Admin';
    $('admin-mode').hidden = !token;
    $('author').hidden = !!token;
    $('author-label').hidden = !!token;
    $('message').placeholder = token ? 'Deine Antwort oder einen Dateilink schreiben …' : 'Schreib etwas …';
    if (!token) cancelReply();
    render();
  }

  async function api(path, { method = 'GET', body, authenticated = false } = {}) {
    if (!base) throw new Error('Die Nachrichtenfunktion wird noch eingerichtet.');
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (authenticated && state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try { response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Keine Verbindung. Bitte versuche es gleich noch einmal.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('Der Nachrichtendienst ist gerade nicht erreichbar.'); }
    if (!response.ok) {
      if (response.status === 401 && authenticated) setSession('');
      throw new Error(data.error || 'Das hat leider nicht geklappt. Bitte erneut versuchen.');
    }
    return data;
  }

  function appendSafeText(element, text) {
    const pattern = /https?:\/\/[^\s<>"']+/giu;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      let href = match[0].replace(/[.,;!?]+$/, '');
      element.append(document.createTextNode(text.slice(cursor, match.index)));
      try {
        const url = new URL(href);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        const link = document.createElement('a');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow ugc'; link.textContent = href;
        element.append(link);
      } catch { element.append(document.createTextNode(href)); }
      cursor = match.index + href.length;
    }
    element.append(document.createTextNode(text.slice(cursor)));
  }

  function chooseReply(message) {
    state.reply = message;
    $('reply-preview').hidden = false;
    $('reply-preview-text').textContent = `${message.author}: ${message.text}`;
    $('message').focus();
    state.requestId = null;
  }
  function cancelReply() { state.reply = null; $('reply-preview').hidden = true; state.requestId = null; }

  function render() {
    const entries = [...state.messages.values()].sort((a,b) => a.id - b.id);
    const timeline = $('timeline');
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 85;
    const fragment = document.createDocumentFragment();
    let previousDay;
    for (const message of entries) {
      const day = dayKey(message.created_at);
      if (day !== previousDay) {
        const separator = document.createElement('div'); separator.className = 'day-separator';
        separator.textContent = day === dayKey(Date.now()) ? 'Heute' : dateFormat.format(new Date(message.created_at));
        fragment.append(separator); previousDay = day;
      }
      const bubble = document.createElement('article');
      bubble.className = `message${message.role === 'admin' ? ' admin' : ''}`;
      bubble.id = `message-${message.id}`;
      const author = document.createElement('div'); author.className = 'message-author'; author.textContent = message.role === 'admin' ? adminName : message.author;
      if (message.role === 'admin') { const badge = document.createElement('span'); badge.className = 'admin-badge'; badge.textContent = 'ADMIN'; author.append(badge); }
      bubble.append(author);
      if (message.reply_to && message.reply_text) {
        const quote = document.createElement('div'); quote.className = 'reply-quote';
        const name = document.createElement('strong'); name.textContent = message.reply_author || 'Gast';
        quote.append(name, document.createTextNode(message.reply_text.slice(0,160) + (message.reply_text.length > 160 ? ' …' : ''))); bubble.append(quote);
      }
      const content = document.createElement('p'); content.className = 'message-text'; appendSafeText(content, message.text); bubble.append(content);
      const bottom = document.createElement('div'); bottom.className = 'message-bottom';
      if (state.token && message.role !== 'admin') { const reply = document.createElement('button'); reply.type = 'button'; reply.textContent = 'Antworten'; reply.setAttribute('aria-label', `Auf Nachricht von ${message.author} antworten`); reply.addEventListener('click', () => chooseReply(message)); bottom.append(reply); }
      const time = document.createElement('time'); time.dateTime = message.created_at; time.title = new Date(message.created_at).toLocaleString('de-CH'); time.textContent = timeFormat.format(new Date(message.created_at)); bottom.append(time); bubble.append(bottom); fragment.append(bubble);
    }
    $('messages').replaceChildren(fragment);
    $('empty-state').hidden = entries.length !== 0 || !state.initial;
    $('older-button').hidden = !state.hasOlder;
    if (nearBottom) timeline.scrollTop = timeline.scrollHeight;
  }

  async function refresh() {
    if (state.loading || !base) return;
    state.loading = true;
    try {
      let more;
      do {
        const newest = state.messages.size ? Math.max(...state.messages.keys()) : 0;
        const data = await api(`/api/messages${state.initial ? `?after=${newest}` : ''}`);
        for (const message of data.messages) state.messages.set(message.id, message);
        if (!state.initial) state.hasOlder = data.has_more;
        more = state.initial && data.has_more;
        const changed = data.messages.length > 0 || !state.initial;
        state.initial = true;
        if (changed) render();
      } while (more);
      connection(config.preview ? 'Vorschau' : 'Verbunden', 'connected');
    } catch (error) { connection('Offline', 'error'); if (!state.initial) showError('form-error', error.message); }
    finally { state.loading = false; }
  }

  $('older-button').addEventListener('click', async () => {
    const button = $('older-button'); button.disabled = true;
    const timeline = $('timeline'), height = timeline.scrollHeight, top = timeline.scrollTop;
    try {
      const first = Math.min(...state.messages.keys()); const data = await api(`/api/messages?before=${first}`);
      data.messages.forEach(message => state.messages.set(message.id, message)); state.hasOlder = data.has_more; render();
      timeline.scrollTop = top + timeline.scrollHeight - height;
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });

  $('message').addEventListener('input', () => {
    const input = $('message'); $('character-count').textContent = `${input.value.length} / 3000`;
    input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,145)}px`; state.requestId = null;
  });
  $('author').addEventListener('input', () => { state.requestId = null; });
  $('message').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('message-form').requestSubmit(); }
  });
  $('cancel-reply').addEventListener('click', cancelReply);

  $('message-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;
    const text = $('message').value.trim();
    if (!text) { showError('form-error','Schreib zuerst eine Nachricht.'); return; }
    showError('form-error'); state.busy = true; $('send-button').disabled = true; $('message').readOnly = true; $('author').readOnly = true;
    state.requestId ||= crypto.randomUUID();
    try {
      const data = await api('/api/messages', { method: 'POST', authenticated: !!state.token, body: { text, author: $('author').value.trim(), reply_to: state.token ? state.reply?.id || null : null, client_id: state.requestId } });
      state.messages.set(data.message.id, data.message); state.initial = true; render();
      $('message').value = ''; $('message').style.height = 'auto'; $('character-count').textContent = '0 / 3000'; cancelReply();
      try { localStorage.setItem('kurz-name', $('author').value); } catch {}
      $('timeline').scrollTop = $('timeline').scrollHeight;
      toast('Nachricht gesendet.');
    } catch (error) { showError('form-error', error.message); }
    finally { state.busy = false; $('send-button').disabled = !base; $('message').readOnly = false; $('author').readOnly = false; }
  });

  $('admin-button').addEventListener('click', async () => {
    if (state.busy) return;
    if (state.token) {
      try { await api('/api/logout', { method:'POST', authenticated: true, body:{} }); setSession(''); toast('Du bist abgemeldet.'); }
      catch (error) { toast(error.message); }
    } else { showError('login-error'); $('login-dialog').showModal(); $('password').focus(); }
  });
  $('close-login').addEventListener('click', () => $('login-dialog').close());
  $('login-dialog').addEventListener('close', () => { $('password').value = ''; });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); showError('login-error'); $('login-submit').disabled = true;
    try {
      const data = await api('/api/login', { method: 'POST', body: { password: $('password').value } });
      setSession(data.token); $('login-dialog').close(); toast('Du kannst jetzt antworten.');
    } catch (error) { showError('login-error', error.message); }
    finally { $('login-submit').disabled = false; $('password').value = ''; }
  });

  setSession(state.token);
  if (!base) {
    connection('In Vorbereitung', 'error'); $('notice').textContent = 'Das Nachrichtenfenster wird gerade eingerichtet. Bald kannst du hier schreiben.'; $('notice').hidden = false; $('send-button').disabled = true; state.initial = true; render();
  } else {
    if (config.preview) { $('notice').textContent = 'Lokale Vorschau · Beispielnachrichten · Admin-Passwort: Vorschau-2026!'; $('notice').hidden = false; }
    if (state.token) api('/api/session', { authenticated:true }).then(() => setSession(state.token)).catch(() => setSession(''));
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('online', refresh);
  }
})();
