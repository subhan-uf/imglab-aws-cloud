const App = (() => {
  // ---------- Config ----------
  const API        = "https://xxxxx.com";
  const COG_DOMAIN = "https://xxxxx.com";
  const CLIENT_ID  = "xxxxxxxxx";

  // Redirect: localhost uses full page URL; prod uses CF root
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const REDIRECT = isLocal
    ? (location.origin + location.pathname)        // e.g. http://127.0.0.1:5500/admin/index.html
    : "https://d3c6k5dylm8spf.cloudfront.net/";   // adjust if hosted at a path

  // ---------- State ----------
  let CURRENT = "pending";              // 'pending' | 'approved' | 'rejected'
  let CACHE = { pending: [], approved: [], rejected: [] };
  let FILTER = "";

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const setStatus = (t) => $("status").textContent = t || "";
  const setCounts = () => {
    $("count-pending").textContent  = CACHE.pending.length;
    $("count-approved").textContent = CACHE.approved.length;
    $("count-rejected").textContent = CACHE.rejected.length;
  };
  const showEmpty = (show) => $("empty").style.display = show ? "block" : "none";

  function decodeJwtPayload(tkn){
    try {
      const b = tkn.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      const s = atob(b);
      return JSON.parse(decodeURIComponent(escape(s)));
    } catch { return {}; }
  }
  function idToken(){ return localStorage.getItem("id_token"); }
  function isLoggedIn(){
    const exp = parseInt(localStorage.getItem("expires_at") || "0", 10);
    return !!idToken() && Date.now() < exp;
  }
  function isAdminFromClaims(claims){
    const groups = claims["cognito:groups"] || [];
    const norm = Array.isArray(groups) ? groups.map(g => String(g).toLowerCase())
                                       : String(groups).toLowerCase().split(",");
    return norm.map(s => s.trim()).includes("admins");
  }
  function showIdentity(){
    const el = $("identity");
    if (!isLoggedIn()){ el.textContent = "Not signed in"; return; }
    const claims = decodeJwtPayload(idToken());
    const email  = claims.email || "(unknown)";
    const admin  = isAdminFromClaims(claims);
    el.innerHTML = `
      <span class="badge"><i class="fa-regular fa-user"></i> ${email}</span>
      ${admin ? '<span class="pill">Admin</span>' : ''}
    `;
  }

  // ---------- PKCE ----------
  async function sha256(plain) {
    const data = new TextEncoder().encode(plain);
    return crypto.subtle.digest("SHA-256", data);
  }
  function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  async function pkceChallenge(verifier){ return b64url(await sha256(verifier)); }

  // ---------- Auth ----------
  async function login(){
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(x => (x % 36).toString(36)).join("");
    localStorage.setItem("pkce_verifier", verifier);
    const challenge = await pkceChallenge(verifier);

    const url = `${COG_DOMAIN}/oauth2/authorize`
      + `?client_id=${CLIENT_ID}`
      + `&response_type=code`
      + `&scope=openid+email`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&code_challenge=${challenge}`
      + `&code_challenge_method=S256`;

    location.href = url;
  }

  function logout(){
    localStorage.removeItem("id_token");
    localStorage.removeItem("expires_at");
    localStorage.removeItem("pkce_verifier");
    location.href = `${COG_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT)}`;
  }

  async function exchangeCodeForToken(code){
    const verifier = localStorage.getItem("pkce_verifier");
    if (!verifier){ alert("Sign-in error. Please try again."); return; }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id:  CLIENT_ID,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier
    });

    const resp = await fetch(`${COG_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await resp.text();
    let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }

    if (!resp.ok){
      console.error("Token exchange failed", resp.status, j);
      alert(`Login failed (${resp.status}). Try again.`);
      return;
    }

    localStorage.setItem("id_token", j.id_token);
    localStorage.setItem("expires_at", String(Date.now() + j.expires_in * 1000));
  }

  // ---------- Tabs ----------
  function switchTab(tab){
    CURRENT = tab;              // "pending" | "approved" | "rejected"
    document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
    $(`tab-${tab}`).classList.add("active");
    setStatus(`Loading ${tab} images…`);
    loadCurrent();
  }

  function refreshCurrent(){
    setStatus("Refreshing…");
    // Force bypass cache by reloading tab data
    loadCurrent(true);
  }

  // ---------- Filtering ----------
  function filterCards(q){
    FILTER = (q || "").toLowerCase();
    renderList(CACHE[CURRENT]);
  }

  // ---------- Fetchers ----------
  async function authGet(path){
    if (!isLoggedIn()){ setStatus("Please sign in."); return { ok:false, items:[] }; }
    const r = await fetch(`${API}${path}`, {
      headers: { "Authorization": "Bearer " + idToken() }
    });
    if (r.status === 403){
      $("unauth").style.display = "block";
      $("grid").innerHTML = "";
      setStatus("");
      return { ok:false, items:[] };
    }
    if (!r.ok){
      setStatus(`Failed to load (${r.status})`);
      return { ok:false, items:[] };
    }
    const data = await r.json();
    return data;
  }

  async function loadCurrent(force=false){
    if (!isLoggedIn()){ setStatus("Please sign in."); return; }

    // Use cache unless forcing refresh
    if (!force && CACHE[CURRENT]?.length){
      renderList(CACHE[CURRENT]);
      setStatus(`${CACHE[CURRENT].length} ${CURRENT} image(s).`);
      return;
    }

    let path = "/admin/pending";
    if (CURRENT === "approved") path = "/admin/approved";
    if (CURRENT === "rejected") path = "/admin/rejected";

    const data = await authGet(path);
    const items = (data.items || []).map(x => ({
      key: x.key,
      url: x.previewUrl || x.url,         // handle either field
      size: x.size,
      lastModified: x.lastModified
    }));

    CACHE[CURRENT] = items;
    setCounts();
    renderList(items);
    setStatus(`${items.length} ${CURRENT} image(s).`);
  }

  // ---------- Render ----------
  function renderList(items){
    const list = $("grid");
    list.innerHTML = "";

    const filtered = FILTER
      ? items.filter(x => x.key.toLowerCase().includes(FILTER))
      : items;

    if (!filtered.length){
      showEmpty(true);
      return;
    }
    showEmpty(false);

    filtered.forEach(x => {
      const card = document.createElement("div");
      card.className = "card";

      const img = document.createElement("img");
      img.className = "thumb";
      img.src = x.url;
      img.alt = x.key;

      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("div");
      name.textContent = x.key;
      const right = document.createElement("div");
      right.innerHTML = `<small>${x.size ? bytes(x.size) : ""} ${x.lastModified ? " • " + dateish(x.lastModified) : ""}</small>`;
      meta.appendChild(name);
      meta.appendChild(right);

      card.appendChild(img);
      card.appendChild(meta);

      if (CURRENT === "pending"){
        const row = document.createElement("div");
        row.className = "row";

        const approve = document.createElement("button");
        approve.className = "btn btn-approve";
        approve.innerHTML = '<i class="fa-solid fa-check"></i> Approve';
        approve.onclick = () => moderate("approve", x.key);

        const reject = document.createElement("button");
        reject.className = "btn btn-reject";
        reject.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject';
        reject.onclick = () => moderate("reject", x.key);

        row.appendChild(approve);
        row.appendChild(reject);
        card.appendChild(row);
      }

      list.appendChild(card);
    });
  }

  // ---------- Actions ----------
  async function moderate(action, key){
    setStatus(`${action} in progress…`);

    const r = await fetch(`${API}/admin/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + idToken()
      },
      body: JSON.stringify({ key })
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false){
      setStatus(`Failed: ${j.error || r.status}`);
      return;
    }

    // Remove from pending cache and optionally push into the destination cache
    CACHE.pending = CACHE.pending.filter(i => i.key !== key);
    if (action === "approve") {
      CACHE.approved.unshift({ key: j.approvedKey || key.replace(/^pending\//, "approved/"), url: undefined });
    } else if (action === "reject") {
      CACHE.rejected.unshift({ key: j.rejectedKey || key.replace(/^pending\//, "rejected/"), url: undefined });
    }

    setCounts();
    renderList(CACHE[CURRENT]);
    setStatus(`${action} successful ✅`);
  }

  // ---------- Utils ----------
  function bytes(n){
    if (!n && n !== 0) return "";
    const u = ["B","KB","MB","GB","TB"];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }
  function dateish(s){
    try { return new Date(s).toLocaleString(); } catch { return ""; }
  }

  // ---------- Boot ----------
  (async () => {
    const params = new URLSearchParams(location.search);
    if (params.get("code")){
      await exchangeCodeForToken(params.get("code"));
      history.replaceState({}, document.title, REDIRECT);
    }

    showIdentity();
    if (isLoggedIn()) { await loadCurrent(); }
    else { setStatus("Please sign in."); }
  })();

  // ---------- Public API ----------
  return {
    login, logout,
    switchTab, refreshCurrent,
    filterCards,
    loadPending: () => { switchTab("pending"); }
  };
})();
