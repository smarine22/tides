// unlock.js - starts the app. If the build was made with a password (tools/build.py --password),
// tides-data.js holds only encrypted data (AES-256-GCM, key from the password by PBKDF2-SHA256).
// The right password decrypts it; the key is then kept on this phone so it is never asked again.
(function () {
  "use strict";
  const KEY_STORE = "tideKey";
  const $ = (id) => document.getElementById(id);
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const L = window.TIDE_LOCKED;

  function start(data) {
    window.TIDE_DATA = data;
    $("lock").classList.remove("show");
    window.startTideApp();
  }

  if (window.TIDE_DATA || !L) { start(window.TIDE_DATA); return; }

  const msg = (t) => { $("lockMsg").textContent = t; };
  if (!window.crypto || !crypto.subtle) {
    $("lock").classList.add("show");
    msg("This page must be opened over https.");
    $("lockForm").style.display = "none";
    return;
  }

  async function decryptWith(rawKey) {
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(L.iv) }, key, b64(L.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function keyFromPassword(pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64(L.salt), iterations: L.iter }, base, 256);
  }

  function savedKey() { try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; } }
  function saveKey(raw) { try { localStorage.setItem(KEY_STORE, toB64(raw)); } catch (e) { /* asked again next time */ } }
  function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ } }

  function ask() {
    $("lock").classList.add("show");
    setTimeout(() => $("lockPw").focus(), 100);
    $("lockForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const pw = $("lockPw").value;
      if (!pw) return;
      msg("Checking…");
      $("lockGo").disabled = true;
      try {
        const raw = await keyFromPassword(pw);
        const data = await decryptWith(raw);
        saveKey(raw);
        msg("");
        start(data);
      } catch (e) {
        msg("Wrong password – try again.");
        $("lockPw").select();
      } finally {
        $("lockGo").disabled = false;
      }
    });
  }

  (async () => {
    const k = savedKey();
    if (k) {
      try { start(await decryptWith(b64(k))); return; }
      catch (e) { forgetKey(); }  // the data was rebuilt with a different password
    }
    ask();
  })();
})();
