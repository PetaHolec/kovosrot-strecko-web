// Ceny a propan-butan se načítají ze souboru data/cenik.json,
// který se upravuje v administraci (/admin). Provozní doba je níže.

let DATA = { categories: [], prices: [], gas: [] };

// 0 = neděle ... 6 = sobota, časy v minutách od půlnoci
const HOURS = {
  1: [[480, 720], [780, 1020]],
  2: [[480, 720], [780, 1020]],
  3: "call",
  4: [[480, 720], [780, 1020]],
  5: [[480, 720], [780, 1020]],
  6: [[540, 720]],
  0: [],
};

const DAYS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const DAYS_IN = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];

const $ = (s) => document.querySelector(s);
const num = (n) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
const kc = (n) => Math.round(n).toLocaleString("cs-CZ") + " Kč";
const time = (m) => String(Math.floor(m / 60)) + (m % 60 ? "." + String(m % 60).padStart(2, "0") : "");
const plain = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);


// ---------- úvod ----------

function initHero() {
  const cats = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));
  const featured = DATA.prices.filter((p) => p.featured && cats[p.cat]).sort((a, b) => b.price - a.price);
  $("#heroTiles").innerHTML = featured.slice(0, 4).map((p) => {
    const c = cats[p.cat];
    return `<div class="el m-${c.metal}">
      <span class="el__no">${c.no}</span>
      <span class="el__sym">${c.sym}</span>
      <span class="el__name">${esc(p.name)}</span>
      <span class="el__price">${num(p.price)}<small>Kč/kg</small></span>
    </div>`;
  }).join("");
}


// ---------- ceník ----------

let activeCat = "";

function renderPrices() {
  const q = plain($("#q").value.trim());
  let html = "";
  let found = 0;

  for (const c of DATA.categories) {
    if (activeCat && activeCat !== c.id) continue;
    const rows = DATA.prices.filter((p) => p.cat === c.id && (!q || plain(p.name).includes(q)));
    if (!rows.length) continue;
    found += rows.length;

    html += `<div class="pgroup">
      <div class="pgroup__head">
        <span class="pgroup__sym m-${c.metal}">${c.sym}</span>
        <h3>${c.name}</h3><small>${rows.length} ×</small>
      </div>`;
    for (const p of rows) {
      let name = esc(p.name);
      if (q) {
        const i = plain(p.name).indexOf(q);
        name = esc(p.name.slice(0, i)) + "<mark>" + esc(p.name.slice(i, i + q.length)) + "</mark>" + esc(p.name.slice(i + q.length));
      }
      html += `<div class="prow"><span class="prow__name">${name}</span><span class="prow__price">${num(p.price)}<small>Kč</small></span></div>`;
    }
    html += "</div>";
  }

  $("#priceList").innerHTML = html;
  $("#nothing").hidden = found > 0;
}

function initPrices() {
  $("#updated").textContent = new Date(DATA.updated).toLocaleDateString("cs-CZ");

  const tiles = $("#catTiles");
  tiles.innerHTML =
    `<button class="cat cat--all is-active" data-cat="" aria-pressed="true"><b>${DATA.prices.length}</b><span>Vše</span></button>` +
    DATA.categories.map((c) =>
      `<button class="cat m-${c.metal}" data-cat="${c.id}" aria-pressed="false"><b>${c.sym}</b><span>${c.short}</span></button>`).join("");

  tiles.addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b) return;
    activeCat = b.dataset.cat;
    tiles.querySelectorAll(".cat").forEach((t) => {
      t.classList.toggle("is-active", t === b);
      t.setAttribute("aria-pressed", String(t === b));
    });
    renderPrices();
  });

  $("#q").addEventListener("input", renderPrices);
  renderPrices();
}


// ---------- výpočet ----------

function initCalc() {
  const items = [];
  $("#ticketDate").textContent = new Date().toLocaleDateString("cs-CZ");

  $("#calcMat").innerHTML = DATA.categories.map((c) =>
    `<optgroup label="${c.name}">` +
    DATA.prices.map((p, i) => p.cat === c.id ? `<option value="${i}">${esc(p.name)} (${num(p.price)} Kč/kg)</option>` : "").join("") +
    `</optgroup>`).join("");

  const render = () => {
    $("#calcList").innerHTML = items.map((it, idx) => {
      const p = DATA.prices[it.i];
      return `<li><span>${esc(p.name)}</span><span class="sum">${kc(it.kg * p.price)}</span>` +
        `<button type="button" data-idx="${idx}" aria-label="Odebrat">×</button>` +
        `<small>${num(it.kg)} kg × ${num(p.price)} Kč</small></li>`;
    }).join("");
    $("#calcTotal").textContent = kc(items.reduce((s, it) => s + it.kg * DATA.prices[it.i].price, 0));
    $("#calcEmpty").hidden = items.length > 0;
    $("#calcClear").hidden = !items.length;
  };

  $("#calcForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#calcKg");
    const kg = parseFloat(input.value.replace(/\s/g, "").replace(",", "."));
    if (!(kg > 0)) { input.focus(); return; }
    const i = Number($("#calcMat").value);
    const same = items.find((it) => it.i === i);
    if (same) same.kg += kg; else items.push({ i, kg });
    input.value = "";
    render();
  });

  $("#calcList").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { items.splice(Number(b.dataset.idx), 1); render(); }
  });

  $("#calcClear").addEventListener("click", () => { items.length = 0; render(); });
  render();
}


// ---------- propan-butan ----------

const BOTTLE = `<svg viewBox="0 0 40 72" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3">
  <rect x="14" y="2" width="12" height="8"/><path d="M10 10h20"/>
  <rect x="5" y="12" width="30" height="56" rx="10"/><path d="M5 32h30M5 48h30"/></svg>`;

function initGas() {
  $("#gas").innerHTML = DATA.gas.map((g) => `
    <div class="gas__item">
      ${BOTTLE}
      <span class="gas__kg">${g.kg}<small>kg</small></span>
      <span></span>
      <p class="gas__price">${kc(g.price)}<span>za lahev</span></p>
    </div>`).join("");
}


// ---------- provozní doba ----------

function nowInPrague() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    min: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

function statusText() {
  const { day, min } = nowInPrague();
  const today = HOURS[day];

  if (today === "call") return { open: false, text: "Dnes jen po domluvě" };

  const cur = today.find(([a, b]) => min >= a && min < b);
  if (cur) return { open: true, text: `Teď otevřeno do ${time(cur[1])}` };

  for (let off = 0; off < 8; off++) {
    const d = (day + off) % 7;
    if (!Array.isArray(HOURS[d])) continue;
    const slot = HOURS[d].find(([a]) => off > 0 || a > min);
    if (slot) {
      const when = off === 0 ? "dnes" : off === 1 ? "zítra" : DAYS_IN[d];
      return { open: false, text: `Teď zavřeno, otevíráme ${when} v ${time(slot[0])}` };
    }
  }
  return { open: false, text: "Teď zavřeno" };
}

function initHours() {
  const { day } = nowInPrague();

  $("#hoursTable").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const h = HOURS[d];
    let val, cls = "";
    if (h === "call") { val = "po domluvě"; cls = "t-call"; }
    else if (!h.length) { val = "zavřeno"; cls = "t-off"; }
    else val = h.map(([a, b]) => `${time(a)}–${time(b)}`).join(" &nbsp;/&nbsp; ");
    if (d === day) cls += " t-today";
    return `<tr class="${cls.trim()}"><td>${DAYS[d]}</td><td>${val}</td></tr>`;
  }).join("");

  const update = () => {
    const s = statusText();
    for (const id of ["#status", "#status2"]) {
      const el = $(id);
      el.className = el.className.replace(/\s?is-(open|closed)/g, "") + (s.open ? " is-open" : " is-closed");
      el.querySelector("span").textContent = s.text;
    }
  };
  update();
  setInterval(update, 60000);
}


// ---------- formulář ----------
// Web nemá vlastní server, zpráva se proto otevře v e-mailovém programu návštěvníka.

function initForm() {
  const form = $("#contactForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = form.elements;
    let ok = true;
    for (const name of ["name", "contact", "message"]) {
      const empty = !f[name].value.trim();
      f[name].classList.toggle("invalid", empty);
      if (empty) ok = false;
    }
    $("#formErr").hidden = ok;
    if (!ok) return;

    const body = `${f.message.value}\n\n${f.name.value}\n${f.contact.value}`;
    location.href = "mailto:strecko.petr@seznam.cz?subject=" +
      encodeURIComponent("Dotaz z webu") + "&body=" + encodeURIComponent(body);
  });
}


$("#year").textContent = new Date().getFullYear();
initHours();
initForm();

fetch("data/cenik.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    DATA = data;
    initHero();
    initPrices();
    initCalc();
    initGas();
  })
  .catch(() => {
    $("#priceList").innerHTML = "";
    $("#nothing").textContent = "Ceník se nepodařilo načíst. Aktuální ceny vám řekneme na tel. 605 252 791.";
    $("#nothing").hidden = false;
  });
