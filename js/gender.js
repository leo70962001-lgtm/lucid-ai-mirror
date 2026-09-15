/**
 * AI 自動判斷：先推薦哪一類妝容（女性／男性）
 *
 * 使用者要求加入。原本的做法是「用問的，不從臉去猜」—— 從臉判斷性別會錯，
 * 猜錯也冒犯人。所以這裡把判斷結果當成**預設值**而不是結論：
 *
 *   1. 只在把握度 ≥ 85% 時才套用；沒把握就退回原本的問法。
 *   2. 套用時照實說「AI 先幫你排了男性妝容（依照片自動判斷，不一定準）」，一鍵就能改，
 *      也不說「你是男性／女性」—— 講的是先排哪一類妝容。
 *   3. 全部在這台機器上跑：照片不上傳，判斷結果不存檔，重新開始就清掉。
 *   4. 只用性別輸出，模型同時算出的年齡**不使用、不保存**。
 *   5. 店家不想用時把 AUTO_GENDER 改成 false，或網址帶 ?nogender。
 *
 * 模型：@vladmandic/face-api 1.7.15 的 AgeGenderNet（MIT，face-api.js 的維護分支），
 * 本機檔案見 vendor/face-api.js 與 models/age_gender_model.*。
 * 這類模型的訓練資料在人種、年齡上有已知的偏差，對跨性別與非二元性別的人也不適用 ——
 * 這正是它只能當預設值、不能當結論的原因。
 */

export const AUTO_GENDER = true;
export const GENDER_MIN_PROB = 0.85;

const relUrl = (p) => new URL(p, document.baseURI).href;
const genderPaths = () => ({
  lib: globalThis.__LUCID_FACEAPI__ || relUrl('vendor/face-api.js'),
  manifest: globalThis.__LUCID_AG_JSON__ || relUrl('models/age_gender_model.json'),
  bin: globalThis.__LUCID_AG_BIN__ || relUrl('models/age_gender_model.bin'),
});

export const genderEnabled = () =>
  AUTO_GENDER && !(typeof location !== 'undefined' && /[?&]nogender(=|&|$)/.test(location.search));

let loading = null;

/** 背景載入模型（開機後就開始，不擋開機）。載不起來就回 null —— 整個功能退回用問的 */
export function initGender() {
  if (!genderEnabled()) return Promise.resolve(null);
  loading ||= (async () => {
    const P = genderPaths();
    const faceapi = await import(P.lib);
    // 先試 WebGL，不行就 CPU。模型只有 112×112 的輸入、每張照片跑一次，CPU 也很快。
    try { await faceapi.tf.setBackend('webgl'); await faceapi.tf.ready(); }
    catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
    // 權重用「清單＋二進位檔」自己解，不用 loadFromUri：
    // 單檔離線版的檔案是 blob 網址，沒有「同一個資料夾」可以相對讀取。
    const manifest = await (await fetch(P.manifest)).json();
    const specs = manifest.flatMap((g) => g.weights);
    const buf = await (await fetch(P.bin)).arrayBuffer();
    faceapi.nets.ageGenderNet.loadFromWeightMap(faceapi.tf.io.decodeWeights(buf, specs));
    // 暖機：WebGL 第一次推論要先編譯著色器（實測約 4–5 秒），之後每次約 20 ms。
    // 在背景先跑一次空白圖，使用者真的拍照時就不會卡在這裡。
    const blank = document.createElement('canvas');
    blank.width = blank.height = 112;
    await faceapi.nets.ageGenderNet.predictAgeAndGender(blank);
    return faceapi.nets.ageGenderNet;
  })().catch((e) => { console.warn('[gender] 模型無法載入，改用問的', e); return null; });
  return loading;
}

/** 從 MediaPipe 關鍵點算出臉的正方形裁切框。留一點邊 —— 模型訓練時用的臉框也帶邊 */
export function faceCropBox(lm, W, H, pad = 0.25) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lm || []) {
    const x = p.x * W, y = p.y * H;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!isFinite(x0)) return null;
  const size = Math.min(Math.max(x1 - x0, y1 - y0) * (1 + pad), W, H);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(0, cx - size / 2), W - size);
  const y = Math.min(Math.max(0, cy - size / 2), H - size);
  return { x: Math.round(x), y: Math.round(y), size: Math.round(size) };
}

/** 模型輸出 → 先排哪一類妝容；把握度不夠就回 null（改用問的） */
export function audienceFromPrediction(pred, min = GENDER_MIN_PROB) {
  if (!pred || !(pred.genderProbability >= min)) return null;
  return pred.gender === 'male' ? 'men' : pred.gender === 'female' ? 'women' : null;
}

/**
 * 對照片跑一次判斷。模型還沒載好（含暖機）時最多等 waitMs，逾時就不猜、改用問的 —— 不為了這個讓使用者多等。
 * 回傳 { audience, prob } 或 null；年齡不在回傳值裡。
 */
export async function guessAudience(canvas, lm, waitMs = 1200) {
  if (!genderEnabled() || !canvas || !lm) return null;
  const net = await Promise.race([initGender(), new Promise((r) => setTimeout(() => r(null), waitMs))]);
  if (!net) return null;
  const b = faceCropBox(lm, canvas.width, canvas.height);
  if (!b || b.size < 32) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 112;
  c.getContext('2d').drawImage(canvas, b.x, b.y, b.size, b.size, 0, 0, 112, 112);
  const pred = await net.predictAgeAndGender(c);
  const p = Array.isArray(pred) ? pred[0] : pred;
  if (!p) return null;
  return { audience: audienceFromPrediction(p), prob: p.genderProbability };
}
