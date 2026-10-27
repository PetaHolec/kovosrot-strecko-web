// Editor ceníku. Stav drží v proměnné `state`, při uložení ho pošle na server (index.php).

const initial = JSON.parse(document.getElementById("initial").textContent);
const csrf = document.querySelector('meta[name="csrf"]').content;
const $ = (s) => document.querySelector(s);

let state = initial.data;
let dirty = false;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => (n === null || n === "" || Number.isNaN(n)) ? "" : String(n).replace(".", ",");
const parse = (s) => {
  const t = String(s).replace(/\s/g, "").replace(",", ".");
  return t === "" ? null : Number(t);
};

function setMsg(text, type = "") {
  const el = $("#msg");
  el.textContent = text;
  el.className = "savebar__msg" + (type ? " is-" + type : "");
}

function markDirty() {
  dirty = true;
  setMsg("Máte neuložené změny", "dirty");
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});


// ---------- kategorie a položky ----------

function renderCategories() {
  $("#categories").innerHTML = state.categories.map((c) => {
    const rows = state.prices
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.cat === c.id);

    return `
      <section class="card">
        <div class="card__head">
          <span class="sym m-${c.metal}">${esc(c.sym)}</span>
          <h2>${esc(c.name)}</h2>
          <span class="count">${rows.length} položek</span>
        </div>
        <div class="rows">
          <div class="row row--head"><span></span><span>Název materiálu</span><span>Kč / kg</span><span title="Zobrazit na úvodní stránce">Úvod</span><span></span></div>
          ${rows.map(({ p, i }, k) => `
            <div class="row" data-i="${i}">
              <span class="move">
                <button type="button" data-act="up" ${k === 0 ? "disabled" : ""} aria-label="Posunout nahoru">▲</button>
                <button type="button" data-act="down" ${k === rows.length - 1 ? "disabled" : ""} aria-label="Posunout dolů">▼</button>
              </span>
              <input type="text" class="name" data-f="name" value="${esc(p.name)}" maxlength="100" aria-label="Název">
              <input type="text" class="price${p.price === null ? " invalid" : ""}" data-f="price" value="${fmt(p.price)}" inputmode="decimal" aria-label="Cena za kg">
              <label class="feat" title="Zobrazit na úvodní stránce"><input type="checkbox" data-f="featured" ${p.featured ? "checked" : ""}><span>Úvod</span></label>
              <button type="button" class="del" data-act="del" aria-label="Smazat ${esc(p.name)}">✕</button>
            </div>`).join("")}
        </div>
        <button type="button" class="add" data-add="${c.id}">+ Přidat položku</button>
      </section>`;
  }).join("");
}

$("#categories").addEventListener("input", (e) => {
  const row = e.target.closest(".row[data-i]");
  if (!row) return;
  const p = state.prices[Number(row.dataset.i)];
  const f = e.target.dataset.f;

  if (f === "name") p.name = e.target.value;
  if (f === "price") {
    const v = parse(e.target.value);
    p.price = v !== null && !Number.isNaN(v) && v >= 0 ? v : null;
    e.target.classList.toggle("invalid", p.price === null);
  }
  if (f === "featured") {
    const count = state.prices.filter((x) => x.featured).length;
    if (e.target.checked && count >= 4) {
      e.target.checked = false;
      setMsg("Na úvod webu se vejdou nejvýše 4 položky. Nejdřív jinou odškrtněte.", "error");
      return;
    }
    if (e.target.checked) p.featured = true; else delete p.featured;
  }
  markDirty();
});

$("#categories").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    // nová položka se vloží za poslední položku dané kategorie
    const cat = add.dataset.add;
    let at = -1;
    state.prices.forEach((p, i) => { if (p.cat === cat) at = i; });
    state.prices.splice(at + 1, 0, { cat, name: "", price: null });
    renderCategories();
    markDirty();
    const rows = add.closest(".card").querySelectorAll(".row[data-i] .name");
    rows[rows.length - 1]?.focus();
    return;
  }

  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const i = Number(btn.closest(".row").dataset.i);
  const p = state.prices[i];

  if (btn.dataset.act === "del") {
    if (p.name && !confirm(`Opravdu smazat „${p.name}“?`)) return;
    state.prices.splice(i, 1);
  } else {
    // posun v rámci kategorie: prohodí se se sousední položkou stejné kategorie
    const dir = btn.dataset.act === "up" ? -1 : 1;
    let j = i + dir;
    while (j >= 0 && j < state.prices.length && state.prices[j].cat !== p.cat) j += dir;
    if (j < 0 || j >= state.prices.length) return;
    [state.prices[i], state.prices[j]] = [state.prices[j], state.prices[i]];
  }
  renderCategories();
  markDirty();
});


// ---------- propan-butan ----------

function renderGas() {
  $("#gas").innerHTML = `
    <div class="row row--gas row--head"><span>Lahev (kg)</span><span>Cena (Kč)</span><span></span></div>` +
    state.gas.map((g, i) => `
      <div class="row row--gas" data-g="${i}">
        <input type="text" data-f="kg" value="${fmt(g.kg)}" inputmode="decimal" aria-label="Velikost lahve v kg" class="${g.kg === null ? "invalid" : ""}">
        <input type="text" data-f="price" value="${fmt(g.price)}" inputmode="decimal" aria-label="Cena lahve" class="${g.price === null ? "invalid" : ""}">
        <button type="button" class="del" aria-label="Smazat lahev">✕</button>
      </div>`).join("");
}

$("#gas").addEventListener("input", (e) => {
  const row = e.target.closest("[data-g]");
  if (!row) return;
  const g = state.gas[Number(row.dataset.g)];
  const v = parse(e.target.value);
  const ok = v !== null && !Number.isNaN(v) && (e.target.dataset.f === "kg" ? v > 0 : v >= 0);
  g[e.target.dataset.f] = ok ? v : null;
  e.target.classList.toggle("invalid", !ok);
  markDirty();
});

$("#gas").addEventListener("click", (e) => {
  const del = e.target.closest(".del");
  if (!del) return;
  state.gas.splice(Number(del.closest("[data-g]").dataset.g), 1);
  renderGas();
  markDirty();
});

$("#addGas").addEventListener("click", () => {
  state.gas.push({ kg: null, price: null });
  renderGas();
  markDirty();
  $("#gas").querySelector(".row[data-g]:last-child input")?.focus();
});


// ---------- datum ----------

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });

$("#updated").value = state.updated;
$("#updated").addEventListener("input", (e) => { state.updated = e.target.value; markDirty(); });
$("#today").addEventListener("click", () => {
  state.updated = $("#updated").value = today();
  markDirty();
});


// ---------- zálohy ----------

function renderBackups(list) {
  $("#backups").innerHTML = list.length
    ? list.map((b) => `<li><span>${esc(b.label)}</span><button type="button" class="btn btn--line btn--sm" data-file="${esc(b.file)}">Obnovit</button></li>`).join("")
    : "<li>Zatím žádné zálohy.</li>";
}

$("#backups").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-file]");
  if (!b) return;
  if (!confirm(`Obnovit ceník ze zálohy ${b.previousElementSibling.textContent}? Současný ceník se nejdřív zazálohuje.`)) return;
  const res = await send({ action: "restore", file: b.dataset.file });
  if (res) {
    dirty = false;
    applyServerData(res);
    setMsg("Záloha obnovena", "ok");
  }
});


// ---------- uložení ----------

async function send(body) {
  try {
    const r = await fetch(location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF": csrf },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(json.error || "Uložení se nepovedlo.", "error"); return null; }
    return json;
  } catch {
    setMsg("Nepodařilo se spojit se serverem. Zkontrolujte připojení.", "error");
    return null;
  }
}

function applyServerData(res) {
  state = res.data;
  $("#updated").value = state.updated;
  renderCategories();
  renderGas();
  renderBackups(res.backups);
}

function check() {
  if (!state.updated) return "Vyplňte datum „Platí od“.";
  const noName = state.prices.find((p) => !p.name.trim());
  if (noName) return "Některá položka nemá vyplněný název.";
  const noPrice = state.prices.find((p) => p.price === null);
  if (noPrice) return `Položka „${noPrice.name}“ nemá platnou cenu.`;
  if (state.gas.some((g) => g.kg === null || g.price === null)) return "U propan-butanu chybí velikost nebo cena lahve.";
  return null;
}

$("#save").addEventListener("click", async () => {
  const err = check();
  if (err) {
    setMsg(err, "error");
    document.querySelector(".invalid")?.focus();
    return;
  }
  const btn = $("#save");
  btn.disabled = true;
  setMsg("Ukládám…");
  const res = await send({ action: "save", data: { updated: state.updated, prices: state.prices, gas: state.gas } });
  btn.disabled = false;
  if (res) {
    dirty = false;
    applyServerData(res);
    setMsg("Uloženo, na webu jsou nové ceny", "ok");
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); $("#save").click(); }
});

renderCategories();
renderGas();
renderBackups(initial.backups);
