// tide.js - harmonic tide prediction and UK time, for the web app.
// A JavaScript port of the ESP32 display's tide_engine.cpp and uktime.cpp
// (same method, same constants - see tools/export_js.py). All times are UTC
// Unix seconds; convert to UK local time only for display.
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // UK time (GMT / BST)
  // ---------------------------------------------------------------------------
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                      "October", "November", "December"];
  const fdiv = (a, b) => Math.floor(a / b);

  function daysFromCivil(y, m, d) {            // Howard Hinnant's algorithm
    y -= m <= 2 ? 1 : 0;
    const era = fdiv(y >= 0 ? y : y - 399, 400);
    const yoe = y - era * 400;
    const doy = fdiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
    const doe = yoe * 365 + fdiv(yoe, 4) - fdiv(yoe, 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civilFromDays(z) {
    z += 719468;
    const era = fdiv(z >= 0 ? z : z - 146096, 146097);
    const doe = z - era * 146097;
    const yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365);
    const doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100));
    const mp = fdiv(5 * doy + 2, 153);
    const d = doy - fdiv(153 * mp + 2, 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
  }
  function weekday(y, m, d) { const z = daysFromCivil(y, m, d); return ((z + 4) % 7 + 7) % 7; }
  function daysInMonth(y, m) {
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function fromUtcFields(y, m, d, hh, mm, ss) { return daysFromCivil(y, m, d) * 86400 + hh * 3600 + mm * 60 + (ss || 0); }
  function lastSunday(y, m) { const last = daysInMonth(y, m); return last - weekday(y, m, last); }
  function isBst(utc) {
    const { y } = civilFromDays(fdiv(utc, 86400));
    const start = fromUtcFields(y, 3, lastSunday(y, 3), 1, 0, 0);
    const end = fromUtcFields(y, 10, lastSunday(y, 10), 1, 0, 0);
    return utc >= start && utc < end;
  }
  function split(t, bst) {
    const days = fdiv(t, 86400), secs = t - days * 86400;
    const c = civilFromDays(days);
    return { year: c.y, month: c.m, day: c.d, hour: fdiv(secs, 3600), minute: fdiv(secs, 60) % 60, second: secs % 60,
             wday: weekday(c.y, c.m, c.d), bst };
  }
  function toLocal(utc) { const b = isBst(utc); return split(utc + (b ? 3600 : 0), b); }
  function localMidnight(y, m, d) {              // clock changes are at 01:00 UTC, never at local midnight
    const asUtc = fromUtcFields(y, m, d, 0, 0, 0);
    return isBst(asUtc - 3600) ? asUtc - 3600 : asUtc;
  }
  function addDays(y, m, d, n) { const c = civilFromDays(daysFromCivil(y, m, d) + n); return [c.y, c.m, c.d]; }

  const UK = { DAY_SHORT, DAY_LONG, MONTH_SHORT, MONTH_LONG, daysFromCivil, civilFromDays, weekday, daysInMonth,
               fromUtcFields, isBst, toLocal, localMidnight, addDays, zoneName: (bst) => (bst ? "BST" : "GMT") };

  // ---------------------------------------------------------------------------
  // Tide engine (method identical to tide_engine.cpp)
  // ---------------------------------------------------------------------------
  const D2R = Math.PI / 180;
  const J2000_UNIX = 946728000;                 // 2000-01-01 12:00 UTC
  const DPC = 36525.0;
  const R_S = 481267.88123421, R_H = 36000.76983, R_P = 4069.0137287, R_N = -1934.136261, R_P1 = 1.7192;
  const RATE = [15.0 + (R_H - R_S) / (24 * DPC), R_S / (24 * DPC), R_H / (24 * DPC), R_P / (24 * DPC), R_P1 / (24 * DPC)];

  function astro(hrs) {
    const T = hrs / (24 * DPC);
    const s = 218.3164477 + R_S * T, h = 280.46646 + R_H * T, p = 83.3532465 + R_P * T;
    const N = 125.04452 + R_N * T, p1 = 282.94 + R_P1 * T;
    return { tau: 15.0 * hrs + 180.0 + h - s, s, h, p, N, p1 };
  }
  function nodalClasses(Ndeg) {
    const n = Ndeg * D2R, c1 = Math.cos(n), c2 = Math.cos(2 * n), c3 = Math.cos(3 * n);
    const s1 = Math.sin(n), s2 = Math.sin(2 * n), s3 = Math.sin(3 * n);
    return {
      f: [1, 1.0004 - 0.0373 * c1 + 0.0002 * c2,
          1.0089 + 0.1871 * c1 - 0.0147 * c2 + 0.0014 * c3,
          1.0060 + 0.1150 * c1 - 0.0088 * c2 + 0.0006 * c3,
          1.0241 + 0.2863 * c1 + 0.0083 * c2 - 0.0015 * c3,
          1.0129 + 0.1676 * c1 - 0.0170 * c2 + 0.0016 * c3,
          1.1027 + 0.6504 * c1 + 0.0317 * c2 - 0.0014 * c3,
          1.043 + 0.414 * c1,
          1.0 - 0.130 * c1],
      u: [0, -2.14 * s1,
          10.80 * s1 - 1.34 * s2 + 0.19 * s3,
          -8.86 * s1 + 0.68 * s2 - 0.07 * s3,
          -17.74 * s1 + 0.68 * s2 - 0.04 * s3,
          -12.94 * s1 + 1.34 * s2 - 0.19 * s3,
          -36.68 * s1 + 4.02 * s2 - 0.57 * s3,
          -23.7 * s1 + 2.7 * s2 - 0.4 * s3,
          0],
    };
  }
  const fmod = (a, b) => a - b * Math.trunc(a / b);

  class TideEngine {
    constructor(data) { this.data = data; this.station = 0; }
    setStation(i) { if (i >= 0 && i < this.data.stations.length) this.station = i; }
    findStation(name) { return this.data.stations.findIndex((s) => s.name === name); }
    get S() { return this.data.stations[this.station]; }

    prepare(hrsAnchor, hrsMid) {
      const a = astro(hrsAnchor), m = astro(hrsMid), nc = nodalClasses(m.N);
      const args = [a.tau, a.s, a.h, a.p, a.p1], S = this.S;
      return this.data.constituents.map((c, k) => {
        let V = 0, w = 0;
        for (let j = 0; j < 5; ++j) { V += c.d[j] * fmod(args[j], 360); w += c.d[j] * RATE[j]; }
        let f = 1, u = 0;
        for (let j = 0; j < 3; ++j) {
          if (!c.nc[j]) continue;
          f *= Math.pow(nc.f[c.nc[j]], c.fp[j]);
          u += c.up[j] * nc.u[c.nc[j]];
        }
        const q = S.coef[k];
        return { phase0: fmod(V + u, 360) * D2R, omega: w * D2R, aT: f * q[0], bT: f * q[1], aH: f * q[2], bH: f * q[3] };
      });
    }

    // Predict a window. Returns {events:[{utc,height,high,range,errMin,errM}], curve:Float64Array, start, step}
    compute(startUtc, hours, curveStepMin) {
      const MARGIN = 14 * 3600, STEP = 60;
      const t0 = startUtc - MARGIN, t1 = startUtc + hours * 3600 + MARGIN;
      const nSteps = Math.floor((t1 - t0) / STEP);
      const hrs0 = (t0 - J2000_UNIX) / 3600, st = this.prepare(hrs0, ((t0 + t1) / 2 - J2000_UNIX) / 3600);
      const K = st.length, S = this.S, dtH = STEP / 3600;
      const cr = new Float64Array(K), ci = new Float64Array(K), rr = new Float64Array(K), ri = new Float64Array(K);
      for (let k = 0; k < K; ++k) { rr[k] = Math.cos(st[k].omega * dtH); ri[k] = Math.sin(st[k].omega * dtH); }
      const finder = (z0) => ({ z0, started: false, above: false, best: 0, bestT: 0, bestPrev: 0, bestNext: 0, prev1: 0, wantNext: false });
      const push = (F, t, z, out) => {
        if (F.wantNext) { F.bestNext = z; F.wantNext = false; }
        const ab = z > F.z0;
        if (!F.started) { F.started = true; F.above = ab; F.best = z; F.bestT = t; F.bestPrev = z; }
        else if (ab !== F.above) {
          const den = F.bestPrev - 2 * F.best + F.bestNext;
          let off = den !== 0 ? 0.5 * (F.bestPrev - F.bestNext) / den : 0;
          off = Math.max(-1, Math.min(1, off));
          out.push({ utc: F.bestT + Math.round(off * STEP), height: F.best - 0.25 * (F.bestPrev - F.bestNext) * off, high: F.above });
          F.above = ab; F.best = z; F.bestT = t; F.bestPrev = F.prev1;
        } else if ((F.above && z > F.best) || (!F.above && z < F.best)) {
          F.best = z; F.bestT = t; F.bestPrev = F.prev1; F.wantNext = true;
        }
        F.prev1 = z;
      };
      const fT = finder(S.z0T), fH = finder(S.z0H), evT = [], evH = [];
      const curveEvery = curveStepMin * 60 / STEP, curveFirst = MARGIN / STEP;
      const nCurve = Math.floor(hours * 60 / curveStepMin) + 1, curve = new Float64Array(nCurve);
      let nc = 0;
      for (let i = 0; i <= nSteps; ++i) {
        if (i % 60 === 0) {
          const tH = i * dtH;
          for (let k = 0; k < K; ++k) { const ph = st[k].phase0 + st[k].omega * tH; cr[k] = Math.cos(ph); ci[k] = Math.sin(ph); }
        }
        let zT = S.z0T, zH = S.z0H;
        for (let k = 0; k < K; ++k) {
          const s = st[k];
          zT += s.aT * cr[k] + s.bT * ci[k];
          zH += s.aH * cr[k] + s.bH * ci[k];
          const nr = cr[k] * rr[k] - ci[k] * ri[k];
          ci[k] = cr[k] * ri[k] + ci[k] * rr[k];
          cr[k] = nr;
        }
        const t = t0 + i * STEP;
        push(fT, t, zT, evT);
        push(fH, t, zH, evH);
        if (i >= curveFirst && (i - curveFirst) % curveEvery === 0 && nc < nCurve) curve[nc++] = zH;
      }
      // time from the timing model, height from the nearest same-type height-model event
      let j = 0;
      for (const e of evT) {
        while (j + 1 < evH.length && Math.abs(evH[j + 1].utc - e.utc) <= Math.abs(evH[j].utc - e.utc)) ++j;
        if (evH.length && evH[j].high === e.high && Math.abs(evH[j].utc - e.utc) < 7200) e.height = evH[j].height;
      }
      const events = [];
      for (let i = 1; i + 1 < evT.length; ++i) {
        const e = evT[i];
        if (e.utc < startUtc || e.utc >= startUtc + hours * 3600) continue;
        const r = Math.abs(e.height - 0.5 * (evT[i - 1].height + evT[i + 1].height));
        const range = r < S.cutNeap ? 0 : r < S.cutSpring ? 1 : 2;
        events.push({ utc: e.utc, height: e.height, high: e.high, range,
                      errMin: S.errMin[e.high ? 0 : 1][range], errM: S.errM[e.high ? 0 : 1][range] });
      }
      return { events, curve: curve.subarray(0, nc), start: startUtc, step: curveStepMin };
    }
  }

  global.UK = UK;
  global.TideEngine = TideEngine;
})(typeof window !== "undefined" ? window : globalThis);
