// app.js - the phone interface (same behaviour as the ESP32 display, laid out for a phone)
// Started by unlock.js once the tide data is available (decrypted if the build has a password).
window.startTideApp = function () {
  "use strict";
  const D = window.TIDE_DATA, engine = new TideEngine(D);
  const $ = (id) => document.getElementById(id);
  const VIEW_MIN = 24 * 60, MARGIN_H = 8, CURVE_STEP = 5, IDLE_MS = 5 * 60 * 1000;
  const SHAPE_HW = 5, SHAPE_LW = 1;           // standard curve for places without a model
  const HEIGHT_ERR_SHOW_M = 0.0995;           // the +- next to a height is shown only from 0.1 m
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowUtc = () => Math.floor(Date.now() / 1000);
  const ukDate = (iso) => String(iso).split("-").reverse().join("-");   // 2026-11-21 -> 21-11-2026

  // ---------------------------------------------------------------- place
  const SHEERNESS = Math.max(0, D.places.findIndex((p) => p.name === "Sheerness"));
  let placeIdx = SHEERNESS, station = 0, portOff = 0;
  const stationOf = (i) => engine.findStation(D.places[i].name);
  const modelPort = () => stationOf(placeIdx) >= 0;
  const offsetMin = (i) => D.places[i].onChatham - D.modelOnChatham;   // minutes added to Sheerness times
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode etc. */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ---------------------------------------------------------------- window and view
  let wk = null;                 // [y, m, d] first day of the window (UK date)
  let dayStart = [], winStart = 0, events = [], curve = null, curveStart = 0;
  let viewMin = 0, selDay = 0, lastTouch = Date.now();
  let Y_MIN = 0, Y_MAX = 7;

  function computeWindow(y, m, d) {
    wk = [y, m, d];
    dayStart = [];
    for (let i = 0; i <= 7; ++i) { const [yy, mm, dd] = UK.addDays(y, m, d, i); dayStart.push(UK.localMidnight(yy, mm, dd)); }
    winStart = dayStart[0];
    const st = modelPort() ? stationOf(placeIdx) : stationOf(SHEERNESS);
    engine.setStation(st < 0 ? 0 : st);
    const s = D.stations[engine.station];
    Y_MIN = modelPort() ? s.plotMin : 0; Y_MAX = modelPort() ? s.plotMax : 7;
    const hours = Math.round((dayStart[7] - winStart) / 3600);
    const r = engine.compute(winStart - MARGIN_H * 3600, hours + 2 * MARGIN_H, CURVE_STEP);
    events = r.events; curve = r.curve; curveStart = r.start;
  }
  const windowMinutes = () => (dayStart[7] - winStart) / 60;
  const maxViewMin = () => windowMinutes() - VIEW_MIN;

  function levelAt(utc) {                       // model curve, linear between 5-minute points
    const x = (utc - curveStart) / (CURVE_STEP * 60);
    if (x < 0 || x > curve.length - 1) return NaN;
    const i = Math.floor(x), f = x - i;
    return i + 1 < curve.length ? curve[i] * (1 - f) + curve[i + 1] * f : curve[i];
  }
  function placeLevel(utc) {                    // the chosen place: model, or a standard wave through its times
    if (modelPort()) return levelAt(utc);
    let lo = -1;
    for (let i = 0; i < events.length; ++i) if (events[i].utc + portOff <= utc) lo = i; else break;
    if (lo < 0 || lo + 1 >= events.length) return NaN;
    const ta = events[lo].utc + portOff, tb = events[lo + 1].utc + portOff;
    const s = 0.5 - 0.5 * Math.cos(Math.PI * (utc - ta) / (tb - ta));
    return events[lo].high ? SHAPE_HW - (SHAPE_HW - SHAPE_LW) * s : SHAPE_LW + (SHAPE_HW - SHAPE_LW) * s;
  }

  function setView(v, fromSlider) {
    viewMin = Math.max(0, Math.min(maxViewMin(), v));
    const mid = winStart + (viewMin + VIEW_MIN / 2) * 60;
    let d = 0;
    while (d < 6 && mid >= dayStart[d + 1]) ++d;
    const changed = d !== selDay;
    selDay = d;
    if (!fromSlider) $("slider").value = Math.round(viewMin / maxViewMin() * 1000);
    if (changed) refreshDay();
    drawGraph();
  }
  function showDay(i) { setView((dayStart[i] - winStart) / 60); }
  function goTo(y, m, d, atEnd) {
    computeWindow(y, m, d);
    selDay = -1;
    refreshWeek();
    if (atEnd) setView(maxViewMin()); else showDay(0);
  }
  function goToday() { const t = UK.toLocal(nowUtc()); goTo(t.year, t.month, t.day); }
  function goNow() {                            // today, graph from 4 h before now (or midnight), table on today
    goToday();
    setView(Math.max(0, (nowUtc() - winStart) / 60 - 240));
    if (selDay !== 0) { selDay = 0; refreshDay(); }
  }
  const isToday = (y, m, d) => { const t = UK.toLocal(nowUtc()); return t.year === y && t.month === m && t.day === d; };
  const showingNow = () => isToday(...wk) && Math.abs(viewMin - Math.max(0, (nowUtc() - winStart) / 60 - 240)) < 2;

  // ---------------------------------------------------------------- header, week bar, tabs
  function refreshClock() {
    const t = UK.toLocal(nowUtc());
    $("clock").textContent = pad2(t.hour) + ":" + pad2(t.minute);
    $("zone").textContent = UK.zoneName(t.bst);
  }
  function refreshWeek() {
    const a = UK.toLocal(dayStart[0] + 43200), b = UK.toLocal(dayStart[6] + 43200);
    $("weekLabel").textContent = `${UK.DAY_SHORT[a.wday]} ${a.day}${a.month !== b.month ? " " + UK.MONTH_SHORT[a.month - 1] : ""}` +
      ` – ${UK.DAY_SHORT[b.wday]} ${b.day} ${UK.MONTH_SHORT[b.month - 1]} ${b.year}`;
    $("dateInput").value = `${wk[0]}-${pad2(wk[1])}-${pad2(wk[2])}`;
    $("sldL").textContent = `${UK.DAY_SHORT[a.wday]} ${a.day}`;
    $("sldR").textContent = `${UK.DAY_SHORT[b.wday]} ${b.day}`;
    const tabs = $("tabs");
    tabs.innerHTML = "";
    for (let i = 0; i < 7; ++i) {
      const t = UK.toLocal(dayStart[i] + 43200), today = isToday(t.year, t.month, t.day);
      const el = document.createElement("button");
      el.className = "tab" + (today ? " today" : "");
      el.innerHTML = `<b>${today ? "Today" : UK.DAY_SHORT[t.wday]}</b><span>${t.day}${today ? " " + UK.MONTH_SHORT[t.month - 1] : ""}</span>`;
      el.onclick = () => { touched(); showDay(i); };
      tabs.appendChild(el);
    }
  }
  function refreshTabs() { [...$("tabs").children].forEach((el, i) => el.classList.toggle("sel", i === selDay)); }

  // ---------------------------------------------------------------- table
  function rowsForDay(d) {
    const out = [], a = dayStart[d], b = dayStart[d + 1], now = nowUtc();
    for (const e of events) { const t = e.utc + portOff; if (t >= a && t < b) out.push({ t, e }); }
    if (now >= a && now < b) {
      const h = placeLevel(now);
      out.push({ t: now, now: true, h, rising: placeLevel(now + 300) > h });
      out.sort((x, y) => x.t - y.t);
    }
    return out;
  }
  function refreshDay() {
    if (selDay < 0) return;
    refreshTabs();
    const d = UK.toLocal(dayStart[selDay] + 43200);
    $("dayTitle").textContent = `${UK.DAY_LONG[d.wday]} ${d.day} ${UK.MONTH_LONG[d.month - 1]} ${d.year}`;
    const rows = rowsForDay(selDay), model = modelPort();
    const zones = new Set(rows.map((r) => UK.toLocal(r.t).bst));
    const zoneTag = zones.size > 1;                       // a clock-change day: show each time's own zone
    $("timeHdr").textContent = zoneTag ? "Time" : `Time (${UK.zoneName([...zones][0] ?? UK.toLocal(dayStart[selDay] + 43200).bst)})`;
    $("htHdr").style.visibility = model ? "visible" : "hidden";
    const tb = $("rows");
    tb.innerHTML = "";
    for (const r of rows) {
      const l = UK.toLocal(r.t), hm = pad2(l.hour) + ":" + pad2(l.minute), z = zoneTag ? ` <small>${UK.zoneName(l.bst)}</small>` : "";
      const tr = document.createElement("tr");
      if (r.now) {
        tr.className = "now";
        tr.innerHTML = `<td class="kind">Now</td><td>${hm}${z} <small>${r.rising ? "▲ rising" : "▼ falling"}</small></td>` +
          `<td>${model && isFinite(r.h) ? r.h.toFixed(2) : ""}</td>`;
      } else {
        const e = r.e;
        const err = model ? `<small>±${e.errMin} min</small>` : `<small>approx.</small>`;
        const ht = model ? e.height.toFixed(2) + (e.errM >= HEIGHT_ERR_SHOW_M ? ` <small>±${e.errM.toFixed(2)}</small>` : "") : "";
        tr.innerHTML = `<td class="kind ${e.high ? "high" : ""}">${e.high ? "High" : "Low"}</td><td>${hm}${z} ${err}</td><td>${ht}</td>`;
      }
      tb.appendChild(tr);
    }
    const note = $("note");
    note.className = "note";
    if (model) note.textContent = "Heights in metres above Chart Datum. 95% of predictions are within ± of the official tide tables. Not for navigation.";
    else {
      const off = offsetMin(placeIdx);
      note.textContent = `Sheerness ${off < 0 ? "−" : "+"}${Math.floor(Math.abs(off) / 60)}:${pad2(Math.abs(off) % 60)} ` +
        "(high-water difference). Approximate times – no heights here. Not for navigation.";
    }
  }

  // ---------------------------------------------------------------- graph
  const cv = $("graph"), ctx = cv.getContext("2d");
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function drawGraph() {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const model = modelPort();
    const P = { l: model ? 40 : 10, r: W - 8, t: 20, b: H - 22 };
    const y = (h) => P.b - (h - Y_MIN) / (Y_MAX - Y_MIN) * (P.b - P.t);
    const x = (utc) => P.l + ((utc - winStart) / 60 - viewMin) / VIEW_MIN * (P.r - P.l);
    ctx.font = "12px system-ui, sans-serif";
    // metre grid
    ctx.strokeStyle = css("--grid"); ctx.lineWidth = 1; ctx.fillStyle = css("--sub"); ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let m = Math.ceil(Y_MIN); m <= Y_MAX; ++m) {
      ctx.beginPath(); ctx.moveTo(P.l, Math.round(y(m)) + 0.5); ctx.lineTo(P.r, Math.round(y(m)) + 0.5); ctx.stroke();
      if (model) ctx.fillText(m + " m", P.l - 5, y(m));
    }
    // hours: grid every 2 h, labels every 4 h, midnight line + day name
    const t0 = winStart + viewMin * 60 - 3600, t1 = t0 + (VIEW_MIN + 120) * 60;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let t = t0 - (t0 % 3600); t <= t1; t += 3600) {
      const l = UK.toLocal(t);
      if (l.minute !== 0) continue;
      const X = Math.round(x(t)) + 0.5;
      if (X < P.l || X > P.r) continue;
      if (l.hour === 0) {
        ctx.strokeStyle = "#9AA5AD"; ctx.beginPath(); ctx.moveTo(X, P.t - 14); ctx.lineTo(X, P.b); ctx.stroke();
        ctx.fillStyle = css("--text"); ctx.textAlign = "left"; ctx.font = "bold 12px system-ui, sans-serif";
        ctx.fillText(`${UK.DAY_SHORT[l.wday]} ${l.day}`, X + 4, 2);
        ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
      } else if (l.hour % 2 === 0) {
        ctx.strokeStyle = css("--grid"); ctx.beginPath(); ctx.moveTo(X, P.t); ctx.lineTo(X, P.b); ctx.stroke();
      }
      if (l.hour % 4 === 0) { ctx.fillStyle = css("--sub"); ctx.fillText(pad2(l.hour) + ":00", X, P.b + 5); }
    }
    // day name at the left edge if no midnight in view
    const leftDay = UK.toLocal(winStart + viewMin * 60);
    ctx.fillStyle = css("--text"); ctx.textAlign = "left"; ctx.font = "bold 12px system-ui, sans-serif";
    if (leftDay.hour >= 2) ctx.fillText(`${UK.DAY_SHORT[leftDay.wday]} ${leftDay.day}`, P.l + 4, 2);
    ctx.font = "12px system-ui, sans-serif";
    // curve
    ctx.save(); ctx.beginPath(); ctx.rect(P.l, P.t - 2, P.r - P.l, P.b - P.t + 2); ctx.clip();
    const pts = [];
    for (let px = P.l; px <= P.r + 1; px += 2) {
      const utc = winStart + (viewMin + (px - P.l) / (P.r - P.l) * VIEW_MIN) * 60, h = placeLevel(utc);
      if (isFinite(h)) pts.push([px, y(h)]);
    }
    if (pts.length > 1) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], P.b);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(pts[pts.length - 1][0], P.b); ctx.closePath(); ctx.fillStyle = css("--fill"); ctx.fill();
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = css("--blue"); ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.restore();
    // high / low water marks
    ctx.textAlign = "center";
    for (const e of events) {
      const t = e.utc + portOff, X = x(t);
      if (X < P.l - 20 || X > P.r + 20) continue;
      const Y = y(model ? e.height : e.high ? SHAPE_HW : SHAPE_LW), l = UK.toLocal(t);
      ctx.fillStyle = css("--blue-d"); ctx.beginPath(); ctx.arc(X, Y, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.textBaseline = e.high ? "bottom" : "top";
      ctx.fillText(pad2(l.hour) + ":" + pad2(l.minute), Math.min(Math.max(X, P.l + 18), P.r - 18), e.high ? Y - 6 : Y + 6);
    }
    // now
    const now = nowUtc(), X = x(now);
    if (X >= P.l && X <= P.r) {
      const h = placeLevel(now);
      if (isFinite(h)) {
        ctx.lineWidth = 3; ctx.strokeStyle = css("--text"); ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(X, y(h), 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        ctx.fillStyle = css("--text"); ctx.beginPath(); ctx.arc(X, y(h), 3.5, 0, 2 * Math.PI); ctx.fill();
      }
    }
    // frame
    ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.l + 0.5, P.t); ctx.lineTo(P.l + 0.5, P.b + 0.5); ctx.lineTo(P.r, P.b + 0.5); ctx.stroke();
  }

  // drag the graph sideways to move through the week (vertical drags still scroll the page)
  let drag = null;
  cv.addEventListener("pointerdown", (e) => { touched(); drag = { x: e.clientX, y: e.clientY, v: viewMin, h: null }; });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.h === null && Math.abs(dx) + Math.abs(dy) > 6) { drag.h = Math.abs(dx) > Math.abs(dy); if (drag.h) cv.setPointerCapture(e.pointerId); }
    if (drag.h) setView(drag.v - dx / (cv.clientWidth - 48) * VIEW_MIN);
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
  cv.style.touchAction = "pan-y";

  // ---------------------------------------------------------------- places
  function applyPlace(i) {
    placeIdx = i;
    portOff = modelPort() ? 0 : offsetMin(i) * 60;
    $("placeName").textContent = D.places[i].name;
    store("place", D.places[i].name);
    if (wk) {                                  // same week, same view, same day in the table
      const v = viewMin, keep = selDay;
      computeWindow(...wk); selDay = -1; setView(v);
      if (keep >= 0 && selDay !== keep) { selDay = keep; refreshDay(); }
    }
  }
  function buildPlaces() {
    const list = $("placeList"), order = D.places.map((p, i) => i).sort((a, b) => D.places[a].name.localeCompare(D.places[b].name));
    list.innerHTML = "";
    for (const i of order) {
      const b = document.createElement("button"), full = stationOf(i) >= 0;
      b.className = "place" + (full ? " full" : "") + (i === placeIdx ? " sel" : "");
      b.innerHTML = D.places[i].name + (full ? "<small>times + heights</small>" : "");
      b.onclick = () => { applyPlace(i); closeSheets(); };
      list.appendChild(b);
    }
  }
  function buildInfo() {
    const rows = D.stations.map((s) => {
      const t = s.errMin.flat(), h = s.errM.flat();
      return `<tr><td>${s.name}</td><td>±${Math.min(...t)}–${Math.max(...t)} min</td><td>±${Math.min(...h).toFixed(2)}–${Math.max(...h).toFixed(2)} m</td></tr>`;
    }).join("");
    $("infoText").innerHTML =
      "<p>Tides are calculated on this phone from harmonic tide models fitted to the official published tables " +
      "(Peel Ports, Port of London Authority, UK Hydrographic Office, Harwich Haven Authority, Port of Dover and others). " +
      "No internet is needed once the app is installed.</p>" +
      "<p><b>Accuracy</b> – 95% of tide predictions fall within the range shown below of the official tide tables (tested on years each model had not seen):</p>" +
      `<table><tr><th>Port</th><th>Times</th><th>Heights</th></tr>${rows}</table>` +
      "<p>Other places use Sheerness times moved by their high-water difference on Chatham (approximate, no heights).</p>" +
      "<p>These are astronomical predictions: wind and air pressure can change the real water level by much more than the ± values. " +
      "<b>Not for navigation.</b></p>" +
      `<p style="color:#5F6B73">Tide models generated ${ukDate(D.generated)}. Times in UK time (GMT/BST automatically).</p>`;
  }
  function openSheet(id) { $(id).classList.add("open"); }
  function closeSheets() { document.querySelectorAll(".sheet").forEach((s) => s.classList.remove("open")); }
  $("placeBtn").onclick = () => { touched(); buildPlaces(); openSheet("placeSheet"); const s = $("placeList").querySelector(".sel"); if (s) s.scrollIntoView({ block: "center" }); };
  $("infoBtn").onclick = () => { touched(); buildInfo(); openSheet("infoSheet"); };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheets));
  document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeSheets(); }));

  // ---------------------------------------------------------------- controls
  function touched() { lastTouch = Date.now(); }
  $("prevWeek").onclick = () => { touched(); goTo(...UK.addDays(...wk, -7), true); };
  $("nextWeek").onclick = () => { touched(); goTo(...UK.addDays(...wk, 7)); };
  $("clockBtn").onclick = () => { touched(); goNow(); };
  $("weekBtn").onclick = () => { touched(); const i = $("dateInput"); if (i.showPicker) { try { i.showPicker(); } catch (e) { /* not allowed here */ } } };
  $("dateInput").onchange = (e) => {
    touched();
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(e.target.value);
    if (m) goTo(+m[1], +m[2], +m[3]);
  };
  $("slider").oninput = (e) => { touched(); setView(e.target.value / 1000 * maxViewMin(), true); };
  window.addEventListener("resize", drawGraph);

  // every 15 s: clock; each minute: table and graph; left alone 5 min (or day changed): back to now
  let lastMinute = -1, lastDay = null;
  function tick() {
    refreshClock();
    const now = nowUtc(), l = UK.toLocal(now), dayKey = `${l.year}-${l.month}-${l.day}`;
    if (lastDay !== null && dayKey !== lastDay && Date.now() - lastTouch > 60000) goNow();
    else if (Date.now() - lastTouch > IDLE_MS && !showingNow() && !document.querySelector(".sheet.open")) goNow();
    else if (Math.floor(now / 60) !== lastMinute) { refreshDay(); drawGraph(); }
    lastMinute = Math.floor(now / 60); lastDay = dayKey;
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  // ---------------------------------------------------------------- start
  const saved = load("place"), si = saved ? D.places.findIndex((p) => p.name === saved) : -1;
  applyPlace(si >= 0 ? si : SHEERNESS);
  refreshClock();
  goNow();
  setInterval(tick, 15000);
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.storage && navigator.storage.persist && navigator.storage.persist();
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline install not available here */ });
  }
  window.__tideApp = { goTo, goNow, setView, applyPlace, rowsForDay: (d) => rowsForDay(d ?? selDay), state: () => ({ wk, selDay, viewMin, placeIdx }) };
};
