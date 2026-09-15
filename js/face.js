import { t } from './i18n.js';
import { SELFTEST_FACE } from './selftest-face.js';
/**
 * MediaPipe Face Landmarker 封裝（478 個關鍵點）
 *
 * 企劃 Step 1 寫的是 68 點；這裡用 478 點，因為唇部輪廓需要
 * 內外唇線分離才能正確渲染唇彩，68 點的唇部精度不夠。
 */

// 全部資源都在本機 vendor/，不碰任何 CDN ——
// 櫃位機台常常沒有外網，而 MediaPipe 的 WASM 有 9.4 MB，
// 連不到就是整個卡在開機畫面。單檔版由 build.mjs 改成內嵌資源。
//
// 這幾個路徑必須在「呼叫時」才讀，不能在模組頂層就取值：
// 單檔離線版是先把 base64 轉成 blob URL 再寫進這些全域變數的，
// 頂層取值會搶在轉換完成之前，抓到的是預設路徑而不是 blob URL。
//
// 路徑一律解析成相對於「文件」的絕對網址。動態 import() 是相對於
// 「模組自己的 URL」解析的，所以 './vendor/…' 從 /js/face.js 會變成
// /js/vendor/… 而 404；fetch() 則是相對於文件。兩者基準不同，
// 不明確指定就會只有其中一個是對的。
//
// 副檔名用 .js 而不是 .mjs：模組匯入會拒絕非 JavaScript 的 MIME，
// 而各家靜態主機對 .mjs 的設定並不一致（有的直接回 octet-stream）。
// 用 .js 就不必賭對方主機的設定。
const rel = (p) => new URL(p, document.baseURI).href;
const paths = () => ({
  vision: globalThis.__LUCID_VISION__ || rel('vendor/vision_bundle.js'),
  wasm:   globalThis.__LUCID_WASM__   || rel('vendor'),
  model:  globalThis.__LUCID_MODEL__  || rel('models/face_landmarker.task'),
});

let landmarker = null;
let mode = null;
// 這台裝置最後用的是哪種偵測模式、自我檢查有沒有過 —— 拍照一直失敗時要顯示出來，遠端才查得到
const info = { delegate: null, selftest: null, gpuError: null };
export const faceInfo = () => ({ ...info });

/**
 * 開機時先用一張「確定有臉」的小圖跑一次偵測。
 *
 * GPU 模式在部分 Android 手機與瀏覽器的組合上（回報：Galaxy S25）會出現
 * 「不報錯、但永遠偵測不到臉」—— 畫面上鏡頭好好的，按拍照卻一直說沒有臉。
 * 這種情況只靠錯誤處理抓不到，所以要主動驗證：驗證沒過就改用 CPU 再來一次。
 */
async function selfTest(lm) {
  try {
    const img = new Image();
    img.src = SELFTEST_FACE;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const res = lm.detect(c);
    return !!res.faceLandmarks?.[0]?.length;
  } catch {
    return false;
  }
}

export async function initFace(onProgress = () => {}) {
  if (landmarker) return landmarker;

  const P = paths();

  onProgress(t('boot.engine'));
  const { FaceLandmarker, FilesetResolver } = await import(P.vision);

  onProgress(t('boot.wasm'));
  // 字串 → 由 FilesetResolver 依 SIMD 支援自己挑檔案；
  // 物件 → 已經指定好路徑（單檔版的 data URI 走這條）。
  const fileset = typeof P.wasm === 'string'
    ? await FilesetResolver.forVisionTasks(P.wasm)
    : P.wasm;

  onProgress(t('boot.model'));
  const create = (delegate) => FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: P.model, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
    // 52 個表情係數：Step 2 用來「猜」心情當預設值（使用者可以改）。
    // 只在靜態影像那一次用得到，即時追蹤不讀它。
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.4,
    minFacePresenceConfidence: 0.4,
  });

  // 先試 GPU（快）；建立失敗或自我檢查沒過，就換 CPU（慢一點，但各家手機都穩）。
  // 網址加 ?cpu 可以直接用 CPU —— 現場排查某支手機時用來比對。
  const forceCPU = /[?&]cpu(=|&|$)/.test(location.search);
  if (!forceCPU) try {
    landmarker = await create('GPU');
    info.delegate = 'GPU';
    info.selftest = await selfTest(landmarker);
    // ?gpufail：模擬「GPU 不報錯但偵測不到臉」，用來驗證自動換 CPU 的那條路
    if (/[?&]gpufail(=|&|$)/.test(location.search)) info.selftest = false;
  } catch (e) {
    info.gpuError = String(e?.message || e).slice(0, 80);
    info.selftest = false;
  }
  if (!info.selftest) {
    try { landmarker?.close?.(); } catch { /* 已經壞掉的就不管它 */ }
    landmarker = await create('CPU');
    info.delegate = 'CPU';
    info.selftest = await selfTest(landmarker);
  }
  mode = 'IMAGE';
  onProgress(t('boot.ready'));
  return landmarker;
}

async function setMode(next) {
  if (mode === next) return;
  await landmarker.setOptions({ runningMode: next });
  mode = next;
}

/** 靜態影像偵測 → 回傳 478 個 normalized landmark，或 null */
let lastShapes = null;
// 影片先畫到一張小畫布再偵測：部分 Android 的 GPU 直接讀 <video> 畫面會出錯或讀到空白，
// 而取景提示只需要知道臉在不在框裡，640px 寬綽綽有餘，手機上也快得多。
let probe = null;
function toProbe(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return video;
  const W = Math.min(640, vw), H = Math.round(vh * W / vw);
  probe ||= document.createElement('canvas');
  if (probe.width !== W || probe.height !== H) { probe.width = W; probe.height = H; }
  probe.getContext('2d').drawImage(video, 0, 0, W, H);
  return probe;
}

export async function detectImage(source) {
  if (!landmarker) return null;
  await setMode('IMAGE');
  const input = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement ? toProbe(source) : source;
  const res = landmarker.detect(input);
  // 表情係數另外存，不改 detectImage 的回傳形狀（呼叫端只要關鍵點）
  const cats = res.faceBlendshapes?.[0]?.categories;
  lastShapes = cats ? Object.fromEntries(cats.map((c) => [c.categoryName, c.score])) : null;
  return res.faceLandmarks?.[0] || null;
}

/** 最近一次靜態偵測的表情係數（名稱 → 0–1），沒有就是 null */
export const lastBlendshapes = () => lastShapes;

/**
 * 影片逐幀偵測（Step 4 即時追蹤用）
 *
 * MediaPipe 的 detectForVideo 要求時間戳「嚴格遞增」，一旦回退整個
 * CalculatorGraph 會直接失敗而且不會自己復原。呼叫端目前傳的是 rAF
 * 時間戳所以沒問題，但只要有人改用別的時鐘、或分頁被暫停後恢復，
 * 就會踩到。這裡強制單調遞增，把它變成呼叫端不需要煩惱的事。
 */
let lastTs = 0;
export async function detectVideo(video, timestampMs) {
  if (!landmarker) return null;
  await setMode('VIDEO');
  const ts = Math.max(Math.round(timestampMs), lastTs + 1);
  lastTs = ts;
  const res = landmarker.detectForVideo(video, ts);
  return res.faceLandmarks?.[0] || null;
}

export const isReady = () => !!landmarker;
