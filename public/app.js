const App = (() => {
  // ===== Config =====
  const API        = "https://raf16ujc43.execute-api.us-east-1.amazonaws.com";
  const COG_DOMAIN = "https://imglab-subhan.auth.us-east-1.amazoncognito.com";
  const CLIENT_ID  = "1hopjf0buvd3ct12844as3tre5";

  // Redirect: localhost uses the full page URL; prod uses the CF public domain root
  const isLocal  = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const REDIRECT = isLocal
    ? (location.origin + location.pathname)              // e.g. http://127.0.0.1:5500/index.html
    : "https://d2kvyx5urqn7yh.cloudfront.net/";         // <-- your public domain

  console.log("REDIRECT →", REDIRECT);

  const ALLOWED_TYPES = ["image/jpeg","image/png","image/webp"];
  const MAX_BYTES = 2 * 1024 * 1024; // 2MB (should match Lambda)

  // ===== Helpers =====
  const $ = (id) => document.getElementById(id);
  function setStatus(t){ $("status").innerHTML = t || ""; }

  // ===== Snackbar =====
  function showSnackbar(message) {
    const snackbar = $("snackbar");
    const snackbarText = $("snackbar-text");
    
    snackbarText.textContent = message;
    snackbar.className = "snackbar show";
    
    // Hide the snackbar after 5 seconds
    setTimeout(() => {
      snackbar.className = "snackbar";
    }, 5000);
  }

  // Close snackbar when close button is clicked
  window.closeSnackbar = function() {
    const snackbar = $("snackbar");
    snackbar.className = "snackbar";
  }

  // ===== PKCE =====
  async function sha256(plain){ const data = new TextEncoder().encode(plain); return crypto.subtle.digest("SHA-256", data); }
  function b64url(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  async function pkceChallenge(v){ return b64url(await sha256(v)); }

  // ===== Auth =====
  async function login(){
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>(x%36).toString(36)).join("");
    localStorage.setItem("pkce_verifier", verifier);
    const challenge = await pkceChallenge(verifier);
    const url = `${COG_DOMAIN}/oauth2/authorize`
      + `?client_id=${CLIENT_ID}`
      + `&response_type=code`
      + `&scope=openid+email`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&code_challenge=${challenge}`
      + `&code_challenge_method=S256`;
    // Update UI before redirect
    updateAuthUI();
    // Small delay to ensure UI updates before redirect
    setTimeout(() => {
      location.href = url;
    }, 100);
  }
  function logout(){
    localStorage.clear();
    // Update UI before redirect
    updateAuthUI();
    location.href = `${COG_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT)}`;
  }
  
  // Toggle authentication state
  function toggleAuth() {
    if (isLoggedIn()) {
      logout();
    } else {
      login();
    }
  }
  
  // Update the updateAuthUI function to work with the toggle button
function updateAuthUI() {
  const authToggleBtn = $("auth-toggle-btn");
  const userEmailSpan = $("user-email");

  if (isLoggedIn()) {
    const email = getUserEmail();
    if (email) {
      userEmailSpan.textContent = email;
      userEmailSpan.style.display = "block";
    }

    authToggleBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Sign Out';
    authToggleBtn.disabled = false;                 // keep enabled
    authToggleBtn.style.opacity = "1";
    authToggleBtn.style.cursor = "pointer";
    authToggleBtn.onclick = function () { App.logout(); };  // wire to logout

    // Enable upload controls
    $("btn-upload").disabled = false;
    $("upload-note").classList.remove("note");
    $("upload-note").classList.add("oknote");
    $("upload-note").innerHTML = `<i class="fa-solid fa-circle-check"></i> Signed in ✅ You get one chance — choose your best photo.`;
  } else {
    userEmailSpan.style.display = "none";
    authToggleBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    authToggleBtn.disabled = false;                 // keep enabled
    authToggleBtn.style.opacity = "1";
    authToggleBtn.style.cursor = "pointer";
    authToggleBtn.onclick = function () { App.login(); };   // wire to login (or toggleAuth)

    // Disable upload controls
    $("btn-upload").disabled = true;
    $("upload-note").classList.add("note");
    $("upload-note").innerHTML = `<i class="fa-solid fa-circle-info"></i> Only one image per person. Sign in to upload.`;
  }
}

  
  // Function to decode JWT token and extract payload
  function parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }
  
  function idToken(){ return localStorage.getItem("id_token"); }
  function isLoggedIn(){
    const exp = parseInt(localStorage.getItem("expires_at") || "0", 10);
    return !!idToken() && Date.now() < exp;
  }
  function getUserEmail() {
    const token = idToken();
    if (!token) return null;
    const payload = parseJwt(token);
    return payload ? payload.email : null;
  }

  async function exchangeCodeForToken(code){
    const verifier = localStorage.getItem("pkce_verifier");
    if (!verifier){ alert("Missing login verifier, please sign in again."); return; }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier
    });
    const resp = await fetch(`${COG_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    const text = await resp.text();
    let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!resp.ok){
      alert("Sign-in failed. Please try again.");
      return;
    }
    localStorage.setItem("id_token", j.id_token);
    localStorage.setItem("expires_at", String(Date.now() + j.expires_in * 1000));
    // Update UI after successful token exchange
    updateAuthUI();
  }

  // ===== Upload UI (drag & drop + preview) =====
  (function wireDrop(){
    const box = $("drop");
    const input = $("file");
    const prev = $("preview");

    function showPreview(file){
      const url = URL.createObjectURL(file);
      prev.style.display = "block";
      prev.innerHTML = `<img src="${url}" alt="preview" style="max-height:200px; border-radius:10px; margin:auto; border: 1px solid #bae6fd;">`;
    }

    function pick(file){
      if (!file){ return; }
      if (!ALLOWED_TYPES.includes(file.type)){
        alert("Only JPG, PNG, WEBP are allowed.");
        input.value = "";
        prev.style.display = "none";
        return;
      }
      if (file.size > MAX_BYTES){
        alert("Max size is 2MB.");
        input.value = "";
        prev.style.display = "none";
        return;
      }
      showPreview(file);
    }

    input.addEventListener("change", e => pick(e.target.files[0]));
    ["dragenter","dragover"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add("drag"); }));
    ["dragleave","drop"].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove("drag"); }));
    box.addEventListener("drop", e => {
      const f = e.dataTransfer.files?.[0];
      if (f){ input.files = e.dataTransfer.files; pick(f); }
    });
  })();

  // ===== Gallery =====
  async function loadGallery(){
    setStatus(`<i class="fa-solid fa-spinner fa-spin"></i> Loading gallery…`);
    try{
      const r = await fetch(API + "/gallery", { method: "GET" });
      const j = await r.json().catch(()=>({items:[]}));
      const grid = $("grid"); grid.innerHTML = "";

      (j.items || []).forEach(it => {
        const card = document.createElement("div");
        card.className = "card";
        const img = document.createElement("img");
        img.className = "thumb";
        img.loading = "lazy";
        img.src = it.url;
        const foot = document.createElement("div");
        foot.className = "foot";
        const left = document.createElement("span");
        left.textContent = it.key.split("/").pop();
        const right = document.createElement("span");
        right.textContent = (it.lastModified ? new Date(it.lastModified).toLocaleDateString() : "");
        foot.appendChild(left); foot.appendChild(right);
        card.appendChild(img); card.appendChild(foot);
        grid.appendChild(card);
      });

      setStatus(`<i class="fa-solid fa-images"></i> ${(j.items || []).length} image(s) loaded`);
    } catch (e){
      setStatus(`<i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i> Gallery failed to load.`);
    }
  }

  // ===== Upload =====
  async function upload(){
    if (!isLoggedIn()){ 
      showSnackbar("Please sign in first to upload your photo.");
      return; 
    }
    const f = $("file").files[0];
    if (!f){ 
      showSnackbar("Please choose an image first.");
      return; 
    }
    if (!ALLOWED_TYPES.includes(f.type)){ 
      showSnackbar("Only JPG, PNG, WEBP are allowed.");
      return; 
    }
    if (f.size > MAX_BYTES){ 
      showSnackbar("Max size is 2MB.");
      return; 
    }

    setStatus(`<i class="fa-solid fa-spinner fa-spin"></i> Requesting secure upload…`);
    const r = await fetch(API + "/presign-upload", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + idToken(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ contentType: f.type })
    });

    const j = await r.json().catch(()=> ({}));
    if (!r.ok || j.ok === false){
      showSnackbar(j.error || "Presign failed. Please try again.");
      setStatus(`<i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i> Upload aborted.`);
      return;
    }

    const form = new FormData();
    Object.entries(j.upload.fields).forEach(([k,v]) => form.append(k,v));
    form.append("file", f);

    const up = await fetch(j.upload.url, { method:"POST", body: form });
    if (up.status === 204){
      setStatus(`<i class="fa-solid fa-circle-check" style="color:#10b981"></i> Uploaded for review. Thank you for sharing your moment ⭐`);
      $("file").value = "";
      $("preview").style.display = "none";
      // Show the snackbar notification
      showSnackbar("Your image has been uploaded! The admin will review and approve it within 24 hours.");
      loadGallery();
    } else {
      showSnackbar("S3 upload failed. Please try again.");
      setStatus(`<i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i> Upload failed.`);
    }
  }

  // ===== Boot =====
  (async ()=>{
    const p = new URLSearchParams(location.search);
    if (p.get("code")){
      await exchangeCodeForToken(p.get("code"));
      history.replaceState({}, document.title, REDIRECT);
    }

    // Update navbar based on auth status
    updateAuthUI();

    loadGallery();
  })();

  // ===== Public API =====
  return { login, logout, loadGallery, upload, closeSnackbar, toggleAuth, updateAuthUI };
})();