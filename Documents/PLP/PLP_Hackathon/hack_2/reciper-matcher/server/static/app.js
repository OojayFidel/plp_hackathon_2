// If you run Flask on a different port, change this:
const API_BASE = ""; // "" -> same origin (http://127.0.0.1:5000). Example: "http://127.0.0.1:5050"

const DEFAULT_IMAGES = ["img/recipe1.jpg", "img/recipe2.jpg", "img/recipe3.jpg"];

// minimal, robust background setter
function setBg(el, url, fallback = "https://placehold.co/800x500?text=Recipe"){
  // try the image first; on load set bg, on error use fallback
  const probe = new Image();
  probe.onload = () => el.style.backgroundImage = `url('${url}')`;
  probe.onerror = () => el.style.backgroundImage = `url('${fallback}')`;
  probe.src = url;
}

const DEVICE_KEY = "rm_device_id";
function getDeviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id){
    // modern UUID if available, else fallback
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}


// ------- Mobile nav toggle -------
const navToggle = document.getElementById("navToggle");
const primaryNav = document.getElementById("primaryNav");
if (navToggle) {
  navToggle.addEventListener("click", () => {
    const open = primaryNav.style.display === "flex";
    primaryNav.style.display = open ? "none" : "flex";
    primaryNav.style.gap = "16px";
    primaryNav.style.flexDirection = "column";
    navToggle.setAttribute("aria-expanded", String(!open));
  });
}

// ------- Ingredient chips logic -------
const popular = [
  "Chicken","Tomatoes","Onions","Garlic","Rice","Pasta","Cheese",
  "Eggs","Spinach","Potatoes","Bell Peppers","Carrots"
];

const selected = new Set();
const suggestionsEl = document.getElementById("suggestions");
const selectedEl = document.getElementById("selected");
const inputEl = document.getElementById("ingredientInput");
const btn = document.getElementById("generateBtn");
const note = document.getElementById("limitNote");
const grid = document.getElementById("recipeGrid");

function renderSuggestions(){
  suggestionsEl.innerHTML = "";
  popular.forEach(item=>{
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = item;
    chip.addEventListener("click",()=>addIngredient(item));
    suggestionsEl.appendChild(chip);
  });
}

function renderSelected(){
  selectedEl.innerHTML = "";
  selected.forEach(item=>{
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.innerHTML = `${item} <span class="x" aria-hidden="true">✕</span>`;
    chip.setAttribute("aria-label", `Remove ${item}`);
    chip.addEventListener("click",()=>removeIngredient(item));
    selectedEl.appendChild(chip);
  });
  const n = selected.size;
  btn.textContent = `Generate Recipes (${n})`;
  btn.disabled = n === 0;
}

function addIngredient(val){
  if (!val) return;
  if (selected.size >= 10) { note.classList.remove("hidden"); return; }
  note.classList.add("hidden");
  selected.add(cap(val));
  renderSelected();
  inputEl.value = "";
}
function removeIngredient(val){
  selected.delete(val);
  renderSelected();
}

function cap(s){ return s.trim().replace(/\s+/g," ").replace(/^./,c=>c.toUpperCase()); }

inputEl.addEventListener("keydown", (e)=>{
  if (e.key === "Enter"){
    e.preventDefault();
    addIngredient(inputEl.value);
  }
});

renderSuggestions();
renderSelected();

// ------- Live generation via API -------
btn.addEventListener("click", async () => {
  const ingredients = Array.from(selected);

  // UI: lock button + show skeletons
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Generating…";
  showSkeletons();

  try {
    // 10s timeout so it never hangs
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);

    const res = await fetch(`${API_BASE}/api/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients }),
      signal: ctrl.signal
    });
    clearTimeout(t);

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    // Render API results (fallback if shape is unexpected)
    if (Array.isArray(data.recipes) && data.recipes.length) {
      renderRecipes(data.recipes);
    } else {
      renderRecipes(fakeRecipes(ingredients));
    }
  } catch (err) {
    console.warn("Suggest error:", err);
    renderRecipes(fakeRecipes(ingredients)); // graceful fallback
  } finally {
    btn.disabled = selected.size === 0;
    btn.textContent = originalText;
  }
});

function showSkeletons(){
  grid.innerHTML = "";
  for (let i=0;i<3;i++){
    const card = document.createElement("div");
    card.className = "card-recipe skel";
    card.innerHTML = `
      <div class="skel-box"></div>
      <div class="skel-line wide"></div>
      <div class="skel-line mid"></div>
      <div class="skel-line" style="width:40%"></div>
    `;
    grid.appendChild(card);
  }
}

function renderRecipes(recipes){
  grid.innerHTML = "";
  recipes.forEach((r, idx)=>{
    const src = r.img || DEFAULT_IMAGES[idx % DEFAULT_IMAGES.length] || "https://placehold.co/800x500?text=Recipe";

    const card  = document.createElement("article");
    card.className = "card-recipe";

    const cover = document.createElement("div");
    cover.className = "card-cover";
    cover.setAttribute("role","img");
    cover.setAttribute("aria-label", `Photo of ${r.title}`);
    setBg(cover, src);                      // <-- set background here

    const body  = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <span class="badge">${r.level}</span>
      <h3 class="card-title">${r.title}</h3>
      <p class="muted">${r.desc}</p>
      <div class="meta">
        <span>⏱️ ${r.time} min</span>
        <span>👥 ${r.serves}</span>
      </div>
      <button class="save-btn" aria-label="Save ${r.title}">Save</button>
    `;

    body.querySelector(".save-btn").addEventListener("click", ()=> saveRecipe(r, body.querySelector(".save-btn")));

    card.appendChild(cover);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

// ---- Real auth handlers ----
document.getElementById("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const name     = form.querySelector('input[name="name"]')?.value.trim() || "";
  const email    = form.querySelector('input[name="email"]')?.value.trim() || "";
  const password = form.querySelector('input[name="password"]')?.value || "";
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, email, password })
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    closeModal(form);
    alert(`Welcome, ${data.user.name || data.user.email}!`);
  } else {
    alert(data.error === "email_exists" ? "Email already registered." : "Sign up failed.");
  }
});

document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const email    = form.querySelector('input[name="email"]')?.value.trim() || "";
  const password = form.querySelector('input[name="password"]')?.value || "";
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.ok && data.ok) {
    closeModal(form);
    alert(`Logged in as ${data.user.name || data.user.email}`);
  } else {
    alert("Invalid email or password.");
  }
});


// app.js (add near the end)
document.querySelectorAll("[data-open]").forEach(btn => {
  btn.addEventListener("click", () => {
    const m = document.getElementById(btn.dataset.open);
    if (m) { m.setAttribute("open",""); document.body.classList.add("modal-open"); }
  });
});

async function saveRecipe(recipe, buttonEl){
  try{
    buttonEl.disabled = true;
    const original = buttonEl.textContent;
    buttonEl.textContent = "Saving…";

    const res = await fetch(`${API_BASE}/api/save`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ device_id: getDeviceId(), recipe })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    console.log("SAVE →", res.status, data);

    if (res.ok && (data.saved || data.message === "Already saved")) {
      buttonEl.textContent = data.saved ? "Saved ✓" : "Saved";
      return;
    }

    buttonEl.textContent = "Try again";
    buttonEl.disabled = false;
  } catch (e){
    console.warn("saveRecipe error", e);
    buttonEl.textContent = "Try again";
    buttonEl.disabled = false;
  }
}


async function loadSaved(){
  const savedGrid = document.getElementById("savedGrid");
  if (!savedGrid) return;
  savedGrid.innerHTML = "";
  // simple skeletons
  for (let i=0;i<3;i++){
    const sk = document.createElement("div");
    sk.className = "card-recipe skel";
    sk.innerHTML = `<div class="skel-box"></div><div class="skel-line wide"></div><div class="skel-line mid"></div>`;
    savedGrid.appendChild(sk);
  }

  try{
    const res = await fetch(`${API_BASE}/api/history?device_id=${encodeURIComponent(getDeviceId())}`);
    const data = await res.json();
    const list = Array.isArray(data.recipes) ? data.recipes : [];
    savedGrid.innerHTML = "";
    list.forEach(r=>{
      const card = document.createElement("article");
      card.className = "card-recipe";
      card.innerHTML = `
        <img src="${r.img}" alt="${r.title}">
        <div class="card-body">
          <span class="badge">${r.level}</span>
          <h3 class="card-title">${r.title}</h3>
          <p class="muted">${r.desc}</p>
          <div class="meta">
            <span>⏱️ ${r.time} min</span>
            <span>👥 ${r.serves}</span>
          </div>
        </div>
      `;
      savedGrid.appendChild(card);
    });
    if (list.length === 0){
      savedGrid.innerHTML = `<p class="muted">No saved recipes yet.</p>`;
    }
  } catch(e){
    console.warn("loadSaved error", e);
    const savedGrid = document.getElementById("savedGrid");
    if (savedGrid) savedGrid.innerHTML = `<p class="muted">Couldn’t load saved recipes.</p>`;
  }
}

// wire the button
document.getElementById("loadSavedBtn")?.addEventListener("click", loadSaved);


function closeModal(node){
  const m = node.closest(".modal");
  if (m){ m.removeAttribute("open"); document.body.classList.remove("modal-open"); }
}

document.querySelectorAll("[data-close]").forEach(btn =>
  btn.addEventListener("click", () => closeModal(btn))
);
document.querySelectorAll(".modal").forEach(m =>
  m.addEventListener("click", e => { if (e.target.classList.contains("modal-backdrop")) closeModal(e.target); })
);
document.addEventListener("keydown", e => {
  if (e.key === "Escape")
    document.querySelectorAll(".modal[open]").forEach(m => { m.removeAttribute("open"); document.body.classList.remove("modal-open"); });
});


// ------- End of script -------