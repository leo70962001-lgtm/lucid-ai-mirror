/**
 * 安裝成 App（PWA）：註冊 service worker、接住瀏覽器的安裝提示、判斷該教使用者怎麼裝。
 *
 * 各平台不一樣：
 *   Android Chrome、電腦版 Chrome / Edge —— 瀏覽器會給一個「可以安裝」的事件，按鈕直接跳出系統的安裝視窗
 *   iPhone / iPad Safari —— 沒有這個事件，只能教：分享 → 加入主畫面
 *   LINE、Facebook、Instagram 的內建瀏覽器 —— 不能安裝，要先用 Safari / Chrome 開
 *   已經裝好、從主畫面打開 —— 什麼都不顯示
 * 畫面（按鈕、說明）在 app.js；這裡只管狀態。
 */
let deferred = null;
let listener = null;

export const isStandalone = () =>
  !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true);
export const isIOS = (ua = globalThis.navigator?.userAgent || '', touch = globalThis.navigator?.maxTouchPoints || 0) =>
  /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touch > 1);      // iPadOS 13 以後自稱 Mac
export const isInApp = (ua = globalThis.navigator?.userAgent || '') => /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);

/**
 * 現在該顯示什麼：
 *   'installed' 已安裝  'prompt' 可以直接跳安裝視窗  'inapp' 要先換瀏覽器  'ios' 教加入主畫面  'none' 這個瀏覽器不支援
 */
export function pwaState(env = {}) {
  const { standalone = isStandalone(), ua, touch, prompt = !!deferred } = env;
  if (standalone) return 'installed';
  if (prompt) return 'prompt';
  if (isInApp(ua)) return 'inapp';
  if (isIOS(ua, touch)) return 'ios';
  return 'none';
}

/** 開機時呼叫一次。onChange：可安裝狀態變了（瀏覽器說可以裝了、裝好了）就通知畫面重畫 */
export function initPWA(onChange) {
  listener = onChange;
  const nav = globalThis.navigator;
  if (!nav || !('serviceWorker' in nav) || location.protocol === 'file:') return false;
  if (/\/_[^/]*\.html$/.test(location.pathname)) return false;     // 測試頁、量測台不註冊
  nav.serviceWorker.register('sw.js').catch(() => { /* 沒有 sw.js（例如單檔版）就當一般網頁 */ });
  // 第一次打開時，模型與 WASM 在 service worker 接手之前就載完了 —— 不補存的話要第二次打開才離線可用。
  // 開機完成後把「剛剛載過的大檔」清單交給它，它從瀏覽器的快取裡補存一份。
  nav.serviceWorker.ready.then((reg) => {
    const urls = (globalThis.performance?.getEntriesByType?.('resource') || [])
      .map((e) => e.name).filter((u) => u.startsWith(location.origin) && /\/(vendor|models)\//.test(u));
    reg.active?.postMessage({ type: 'warm', urls: [...new Set(urls)] });
  }).catch(() => {});
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listener?.(); });
  addEventListener('appinstalled', () => { deferred = null; listener?.(); });
  return true;
}

/** 跳出系統的安裝視窗（只有 'prompt' 狀態有用）。回傳使用者有沒有按安裝 */
export async function promptInstall() {
  const e = deferred; if (!e) return false;
  deferred = null;
  e.prompt();
  const r = await e.userChoice.catch(() => null);
  listener?.();
  return r?.outcome === 'accepted';
}
