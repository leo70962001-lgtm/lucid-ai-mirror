/**
 * 核心邏輯驗證：node test.mjs
 * 只測純函式（色彩科學 + 推薦），不需要瀏覽器或相機。
 */

import { classifySkin, rgbToLab, deltaE, wbGain, applyGain, estimateCCT, rankLooks } from './js/analysis.js';
import { LOOKS, PRODUCTS, resolveLook, toneLabel } from './js/products.js';
import { PATCHES, fitDisplay, correctRgb, xyzToLab, simulateDisplay, SRGB_PANEL } from './js/calib.js';
import { pressureLevel, applyPressure } from './js/makeup-gl.js';
import { FACE_SHAPES, PROTOTYPES, CELEBS, classifyFace, faceLookBonus, faceReasonFor } from './js/faceshape.js';
import { readFileSync } from 'node:fs';
import { lineEmoji, optEmoji } from './js/emoji.js';
import { audienceFromPrediction, faceCropBox, GENDER_MIN_PROB } from './js/gender.js';
import { CHART24, fitCCM, applyCCM, fitGainOnly, patchCenters, orientQuad, fitFromCanvas } from './js/chart.js';
import { contextAdvice, adjustIntensity, rankWithContext, moodFromFace, externalWeather,
         MOODS, WEATHERS, PLANS } from './js/context.js';
import { onSkin, onLook, onPicks, onShadeChange, onAmount, onFinish, lightNote, KINDS,
         optsForSkin, optsForPicks, optsForAR, optsForFinish, explain, onAR, ACTS,
         dropAsked, dropDeadAmount, askAmount, newPref, notePref, noteDwell, prefTone, prefBias,
         pickNext, prefNote, prefRecall, observe, sessionSummary, DWELL_MS,
         askContext, onContext, dropAnswers, optsAfterWhy, EXPLAIN_ACTS,
         nearestRegion, onRegion, readGesture, plainSkin, plainFace, plainBlush, plainLook, plainCeleb,
         askAudience, askAudienceGuess, audienceBonus, plainGroom, askLevel, levelBonus, levelTip,
         adjustHint, shadeHint, buyAdvice, DIR_KEYS,
         colorStatus, colorLines, colorGuide, optsForColor, colorGuideOpts, ANSWER_ACTS } from './js/advisor.js';

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

let fail = 0;
const ok = (c, m) => { console.log((c ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + m); if (!c) fail++; };
const hexLab = (h) => { const n = parseInt(h.slice(1), 16); return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255); };

console.log('\n\x1b[1m1. CIELAB 轉換基準值\x1b[0m');
const white = rgbToLab(255, 255, 255), black = rgbToLab(0, 0, 0), mid = rgbToLab(128, 128, 128);
ok(Math.abs(white.L - 100) < 0.5 && Math.abs(white.a) < 1 && Math.abs(white.b) < 1,
   `純白 → L*=${white.L.toFixed(1)} a*=${white.a.toFixed(2)} b*=${white.b.toFixed(2)}`);
ok(black.L < 0.5, `純黑 → L*=${black.L.toFixed(2)}`);
ok(Math.abs(mid.L - 53.6) < 1, `中灰 → L*=${mid.L.toFixed(1)}（標準值 53.6）`);

console.log('\n\x1b[1m2. 膚色深度分類（ITA°）\x1b[0m');
const DEPTHS = [
  ['極淺 / 北歐',   [245, 226, 210]], ['淺 / 東亞',   [232, 200, 174]],
  ['中等 / 地中海', [206, 166, 132]], ['小麥 / 南亞', [173, 128,  95]],
  ['深 / 非裔',     [120,  80,  57]], ['極深',        [ 72,  46,  33]],
];
const seen = new Set();
for (const [n, rgb] of DEPTHS) {
  const s = classifySkin(rgb); seen.add(s.depthKey);
  console.log(`  ${n.padEnd(15)} ITA ${s.itaDeg.toFixed(1).padStart(6)}°  →  ${s.depthKey}`);
}
ok(seen.size >= 4, `6 個樣本落入 ${seen.size} 個深度分類`);
ok(classifySkin(DEPTHS[0][1]).itaDeg > classifySkin(DEPTHS[5][1]).itaDeg, 'ITA° 隨膚色變深而單調下降');

console.log('\n\x1b[1m3. 底調判定 — 殘差法\x1b[0m');
const TONES = [
  ['淺 · 偏黃',  [231, 196, 150], 'warm'],
  ['淺 · 橄欖',  [214, 184, 140], 'warm'],
  ['淺 · 偏紅',  [231, 186, 186], 'cool'],
  ['淺 · 粉調',  [240, 214, 208], 'cool'],
  ['淺 · 中性',  [225, 195, 172], 'neutral'],
  ['小麥 · 偏黃',[178, 132,  82], 'warm'],
  ['深 · 偏紅',  [135,  85,  72], 'cool'],
  ['深 · 中性',  [120,  80,  57], 'neutral'],
];
for (const [n, rgb, want] of TONES) {
  const s = classifySkin(rgb);
  const got = s.undertone;
  console.log(`  ${n.padEnd(13)} L* ${s.lab.L.toFixed(0).padStart(3)}  h ${s.hue.toFixed(1).padStart(5)}°  殘差 ${s.residual.toFixed(1).padStart(6)}°  →  ${toneLabel(got)}`);
  if (got !== want) ok(false, `${n} 應判為 ${toneLabel(want)}，實得 ${toneLabel(got)}`);
}
ok(TONES.every(([, rgb, w]) => classifySkin(rgb).undertone === w), '8 個樣本底調判定全部正確');

console.log('\n\x1b[1m4. 公平性 — 深膚色的底調不能被膚色深度吃掉\x1b[0m');
const deepTones = TONES.filter(([n]) => n.startsWith('深')).map(([, rgb]) => classifySkin(rgb).undertone);
ok(new Set(deepTones).size > 1, `深膚色樣本得到 ${new Set(deepTones).size} 種不同底調（若全部相同代表分類器對深膚色失效）`);
const deepWarn = classifySkin([120, 80, 57]).warnings;
// 警語現在回傳的是 i18n key（分析層不該知道畫面說什麼語言）
ok(deepWarn.includes('warn.deep'), '深膚色會主動提示信心較低，而不是假裝有把握');

console.log('\n\x1b[1m5. product-first — 推薦必定對得上真實且有貨的商品\x1b[0m');
let bad = 0;
for (const tone of ['warm', 'cool', 'neutral']) for (const look of LOOKS) {
  const p = resolveLook(look, tone);
  for (const c of ['lip', 'eye', 'cheek'])
    if (!PRODUCTS.some((x) => x.id === p[c].id) || p[c].stock <= 0) bad++;
}
ok(bad === 0, `12 組（3 底調 × 4 妝容）× 3 部位 = 36 個推薦，全部命中真實且有庫存的商品`);

console.log('\n\x1b[1m6. 庫存聯動\x1b[0m');
const oos = PRODUCTS.filter((p) => p.stock <= 0);
console.log(`  目前缺貨：${oos.map((p) => p.shade).join('、') || '無'}`);
let leaked = false;
for (const tone of ['warm', 'cool', 'neutral']) for (const look of LOOKS)
  for (const c of ['lip', 'eye', 'cheek'])
    if (oos.some((o) => o.id === resolveLook(look, tone)[c].id)) leaked = true;
ok(!leaked, '缺貨色號從未出現在任何推薦中（避免推薦了櫃上沒貨的商品）');

console.log('\n\x1b[1m7. 推薦可解釋性\x1b[0m');
const d = resolveLook(LOOKS[0], 'warm');
console.log(`  自然偽素顏 × 暖色調 → ${d.lip.shade}｜理由：${d.lip._reason.map((r) => r[0]).join('、')}`);
ok(['lip', 'eye', 'cheek'].every((c) => d[c]._reason.length > 0), '每個推薦都附帶可顯示給顧客的理由，非黑箱');

console.log('\n\x1b[1m8. 色號區辨度（ΔE）\x1b[0m');
const lips = PRODUCTS.filter((p) => p.cat === 'lip');
let minDE = Infinity, pair = '';
for (let i = 0; i < lips.length; i++) for (let j = i + 1; j < lips.length; j++) {
  const e = deltaE(hexLab(lips[i].color), hexLab(lips[j].color));
  if (e < minDE) { minDE = e; pair = `${lips[i].shade} ↔ ${lips[j].shade}`; }
}
console.log(`  最接近的兩色：${pair}　ΔE = ${minDE.toFixed(1)}`);
ok(minDE > 2.3, '所有唇色 ΔE > 2.3（肉眼可分辨門檻），色號不會擠在一起分不出來');

console.log('\n\x1b[1m9. 環境光補償 — 櫃位燈光不能改變膚色判定\x1b[0m');
// 光源在線性光量空間相乘，不是在 sRGB 編碼值上 —— 模擬也必須這樣做，
// 否則測的是「兩個錯誤互相抵消」而不是演算法本身。
// 光源已正規化到最大通道 = 1，模擬相機自動曝光後不會過曝截頂。
const srgb2lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lin2srgb = (v) => {
  v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
/**
 * 由色溫算出光源的線性 RGB —— 用普朗克軌跡（Kim et al. 2002 近似式），
 * 不是我隨手編的比例。相對於 D65 正規化，並讓最大通道 = 1
 * （模擬相機自動曝光，不會過曝截頂）。
 */
function illuminantRGB(T) {
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.179910
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.240390;
  const y = T <= 2222
    ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000
    ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    :  3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  return [
    Math.max(0,  3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0,  0.0557 * X - 0.2040 * Y + 1.0570 * Z),
  ];
}
const D65 = illuminantRGB(6504);
const relative = (T) => {
  const c = illuminantRGB(T).map((v, i) => v / D65[i]);
  const m = Math.max(...c);
  return c.map((v) => v / m);
};
const LIGHTS = [
  ['鹵素投射燈 2700K', relative(2700)],
  ['暖白 LED 3500K',   relative(3500)],
  ['中性 D65',         [1, 1, 1]],
  ['冷白 8000K',       relative(8000)],
];
const SCLERA = [236, 236, 238];                 // 眼白（接近中性，略偏藍）
const under = (rgb, L) => rgb.map((v, i) => lin2srgb(srgb2lin(v) * L[i]));

let drifted = 0, recovered = 0;
for (const [skinName, skinD65] of [['淺 · 暖', [231, 196, 150]], ['淺 · 中性', [225, 195, 172]], ['小麥 · 暖', [178, 132, 82]]]) {
  const base = classifySkin(skinD65).undertone;
  for (const [lightName, L] of LIGHTS) {
    const obsSkin   = under(skinD65, L);
    const obsSclera = under(SCLERA, L);
    const raw = classifySkin(obsSkin).undertone;
    const fix = classifySkin(applyGain(obsSkin, wbGain(obsSclera))).undertone;
    const cct = estimateCCT(obsSclera);
    if (raw !== base) drifted++;
    if (fix === base) recovered++;
    console.log(`  ${skinName.padEnd(10)} ${lightName.padEnd(14)} ${String(cct).padStart(5)}K` +
                `  未補償 ${toneLabel(raw).padEnd(4)}${raw === base ? '  ' : '✗ '}` +
                `→ 補償後 ${toneLabel(fix)}${fix === base ? ' ✓' : ' ✗'}`);
  }
}
ok(drifted > 0, `不補償時有 ${drifted}/12 組被燈光帶偏（證明這個問題是真的，不是假想）`);
ok(recovered === 12, `補償後 ${recovered}/12 組還原成 D65 下的判定`);

console.log('\n\x1b[1m10. 色溫估計\x1b[0m');
for (const [n, rgb, want] of [['D65 純白', [255,255,255], 6504], ['暖白', [255,214,170], 4100], ['冷白', [214,226,255], 8800]]) {
  const c = estimateCCT(rgb);
  console.log(`  ${n.padEnd(10)} ${String(c).padStart(5)} K`);
  if (n === 'D65 純白') ok(Math.abs(c - 6504) < 30, `D65 純白 → ${c}K（標準值 6504K）`);
}
ok(estimateCCT([255,214,170]) < estimateCCT([214,226,255]), '暖光的色溫低於冷光（方向沒有搞反）');

console.log('\n\x1b[1m11. 顯示端校色 — 偏掉的螢幕能不能救回來\x1b[0m');
// 一台便宜機台螢幕：三原色偏移 + 每通道 gamma 不一致
const BAD = {
  gamma: [2.45, 2.25, 2.05],
  M: [[0.4500, 0.3300, 0.1900],
      [0.2300, 0.7000, 0.0700],
      [0.0150, 0.0950, 1.0300]],
};
// 共同白點用 sRGB 的白 —— 各自用自己的白會把白點偏差「適應掉」，
// 那是自欺欺人：我們要的是跟實品的絕對一致。
const WHITE = simulateDisplay([255, 255, 255], SRGB_PANEL);
const labOn = (rgb, panel, transfer) => xyzToLab(sim(rgb, panel, transfer), WHITE);
function sim([r, g, b], panel, transfer) {
  const lin = [r / 255, g / 255, b / 255].map((v, i) =>
    transfer ? transfer(v, panel.gamma[i])
    : panel.transfer ? panel.transfer(v)
    : Math.pow(v, panel.gamma[i]));
  return {
    X: panel.M[0][0]*lin[0] + panel.M[0][1]*lin[1] + panel.M[0][2]*lin[2],
    Y: panel.M[1][0]*lin[0] + panel.M[1][1]*lin[1] + panel.M[1][2]*lin[2],
    Z: panel.M[2][0]*lin[0] + panel.M[2][1]*lin[1] + panel.M[2][2]*lin[2],
  };
}
const measure = (panel, transfer, noise = 0) => {
  const m = {};
  for (const p of PATCHES) {
    const v = sim(p.rgb, panel, transfer);
    const n = () => 1 + (noise ? (Math.random() * 2 - 1) * noise : 0);
    m[p.id] = { X: v.X * n(), Y: v.Y * n(), Z: v.Z * n() };
  }
  return m;
};

const shades = PRODUCTS.map((p) => ({ id: p.id, rgb: hexRgb(p.color) }));
function evaluate(panel, transfer, model) {
  let before = 0, after = 0, worst = 0, clip = 0;
  for (const s of shades) {
    const want = labOn(s.rgb, SRGB_PANEL);
    before += deltaE(want, labOn(s.rgb, panel, transfer));
    const c = correctRgb(s.rgb, model);
    if (c.clipped) clip++;
    const d = deltaE(want, labOn(c.rgb, panel, transfer));
    after += d; worst = Math.max(worst, d);
  }
  return { before: before / shades.length, after: after / shades.length, worst, clip };
}

const modelExact = fitDisplay(measure(BAD));
ok(!modelExact.error, `擬合成功　γ = [${modelExact.gamma?.map((g) => g.toFixed(3)).join(', ')}]（真值 2.45, 2.25, 2.05）`);
const rExact = evaluate(BAD, null, modelExact);
console.log(`  理想量測      平均 ΔE ${rExact.before.toFixed(1)} → ${rExact.after.toFixed(2)}　最差 ${rExact.worst.toFixed(2)}　夾限 ${rExact.clip}/12`);
ok(rExact.after < 0.5, `校正後平均 ΔE ${rExact.after.toFixed(2)}（校正前 ${rExact.before.toFixed(1)}）`);

// 色差儀有雜訊 —— 校正必須撐得住，不能只在完美資料下成立
const rNoise = evaluate(BAD, null, fitDisplay(measure(BAD, null, 0.005)));
console.log(`  ±0.5% 量測雜訊 平均 ΔE ${rNoise.before.toFixed(1)} → ${rNoise.after.toFixed(2)}　最差 ${rNoise.worst.toFixed(2)}`);
ok(rNoise.after < 2.3, `有量測雜訊時校正後平均 ΔE ${rNoise.after.toFixed(2)} < 2.3（肉眼可分辨門檻）`);

// 真實面板不是純冪次曲線。這裡加一段 S 形偏差，量出模型本身的極限。
const sCurve = (v, g) => Math.pow(v, g) * (1 + 0.06 * Math.sin(Math.PI * v));
const rS = evaluate(BAD, sCurve, fitDisplay(measure(BAD, sCurve)));
console.log(`  非純冪次響應   平均 ΔE ${rS.before.toFixed(1)} → ${rS.after.toFixed(2)}　最差 ${rS.worst.toFixed(2)}`);
ok(rS.after < rS.before * 0.25, `模型不完全吻合時仍改善 ${(rS.before / rS.after).toFixed(1)} 倍（殘差 ΔE ${rS.after.toFixed(2)}）`);

// 色差儀的輸出單位不固定：有的給 cd/m²，有的以白 = 100。
// 擬合結果必須與尺度無關，否則校正會安靜地錯掉好幾個數量級。
const scaled = (() => { const m = measure(BAD); const o = {};
  for (const k of Object.keys(m)) o[k] = { X: m[k].X * 100, Y: m[k].Y * 100, Z: m[k].Z * 100 };
  return o; })();
const rScaled = evaluate(BAD, null, fitDisplay(scaled));
console.log(`  量測值 ×100    平均 ΔE ${rScaled.before.toFixed(1)} → ${rScaled.after.toFixed(2)}`);
ok(Math.abs(rScaled.after - rExact.after) < 0.05, `量測單位放大 100 倍，結果不變（ΔE ${rExact.after.toFixed(2)} vs ${rScaled.after.toFixed(2)}）`);

// 缺量測值要明講，不能默默用半套資料擬合
ok(fitDisplay({ R100: { X: 1, Y: 1, Z: 1 } }).error?.includes('缺少'), '量測不完整時回報錯誤而不是硬算');


console.log('\n\x1b[1m12. 筆壓\x1b[0m');
{
  const SENS = 0.65;                       // 面板預設值

  // 不支援筆壓的裝置：規格規定按下去回 0.5、放開回 0。
  // 0 一定要當成「未知 → 滿壓」，否則所有滑鼠使用者的妝會無故淡掉。
  ok(pressureLevel(0, SENS) === 1 && pressureLevel(-1, SENS) === 1 && pressureLevel(NaN, SENS) === 1,
     '裝置不回報筆壓（0 / 負值 / NaN）時一律滿壓，不會莫名其妙變淡');

  // 靈敏度 0 必須「完全等於」沒有筆壓，不是「影響很小」——
  // 一般觸控螢幕的機台要能把它整個關掉。
  const off = [0.01, 0.2, 0.5, 0.8, 1].every((r) => pressureLevel(r, 0) === 1);
  ok(off, '靈敏度 0 時任何筆壓都回 1，與加筆壓之前逐位元組相同');

  // 單調遞增：壓越大一定越濃，不能有反轉
  const lv = [0.05, 0.2, 0.4, 0.6, 0.8, 1].map((r) => pressureLevel(r, 1));
  ok(lv.every((v, i) => i === 0 || v > lv[i - 1]),
     '筆壓越大濃度越高（' + lv.map((v) => v.toFixed(2)).join(' < ') + '）');

  // 滿壓一定回到 1，否則使用力壓也達不到滑桿設定的濃度
  ok(Math.abs(pressureLevel(1, 1) - 1) < 1e-9 && Math.abs(pressureLevel(1, SENS) - 1) < 1e-9,
     '滿壓 = 濃度滑桿的設定值（靈敏度多少都一樣）');

  // 曲線用 p^0.65 而不是線性：輕壓要還看得見。
  // 線性的話 0.1 的力道只有 0.10 的濃度，等於白畫。
  const light = pressureLevel(0.1, 1);
  ok(light > 0.2 && light < 0.3,
     '輕壓（0.1）仍有 ' + light.toFixed(2) + ' 的濃度，線性對應只會有 0.10');

  // 半徑跟濃度的關係：濃度線性掉到 0，半徑只掉到 0.62。
  // 兩個都線性歸零的話，輕壓會變成又小又淡的一點，看起來像沒畫到。
  const base = { color: '#C0293E', alpha: 0.088, radius: 26, bias: 0 };
  const soft = applyPressure(base, pressureLevel(0.1, 1));
  const hard = applyPressure(base, pressureLevel(1, 1));
  ok(Math.abs(hard.alpha - base.alpha) < 1e-9 && Math.abs(hard.radius - base.radius) < 1e-9,
     '滿壓時的一筆與沒有筆壓時完全相同（alpha ' + hard.alpha + '、radius ' + hard.radius + '）');
  ok(soft.alpha < base.alpha * 0.3 && soft.radius > base.radius * 0.6,
     '輕壓濃度掉到 ' + (soft.alpha / base.alpha).toFixed(2) + ' 倍，半徑只掉到 ' +
     (soft.radius / base.radius).toFixed(2) + ' 倍（不會變成一個小點）');

  // bias 不另外乘：stamp() 裡珠光是 alpha * bias，濃度乘下去就跟著淡了
  ok(soft.bias === base.bias && applyPressure({ ...base, bias: 40 }, 0.5).bias === 40,
     '珠光的 bias 不被重複乘一次（stamp 裡本來就是 alpha × bias）');
}


console.log('\n\x1b[1m13. 情境推薦（心情 / 天氣 / 行程）\x1b[0m');
{
  // 沒選 = 完全不影響。這條最重要：不說話的人不該被系統自作主張
  const none = contextAdvice({});
  ok(!none.any && none.reasons.length === 0 && Object.keys(none.finish).length === 0 &&
     ['lip', 'eye', 'cheek'].every((k) => none.amount[k] === 1),
     '三項都沒選時：不改質地、不改濃度、沒有任何理由');

  const base = { lip: 0.65, eye: 0.40, cheek: 0.42 };
  ok(JSON.stringify(adjustIntensity(base, none.amount)) === JSON.stringify(base),
     '　濃度與妝容原本設定逐項相同');

  // 天氣 → 質地
  ok(contextAdvice({ weather: 'hot' }).finish.lip === 'matte', '悶熱 → 唇改霧面（不易脫妝）');
  ok(contextAdvice({ weather: 'cold' }).finish.lip === 'gloss', '乾冷 → 唇改水光（唇容易裂）');
  ok(contextAdvice({ weather: 'humid' }).finish.eye === 'matte', '潮濕 → 眼妝改霧面（不易暈染）');

  // 心情 → 濃度，且不會超過滑桿上限
  const tired = contextAdvice({ mood: 'tired' });
  ok(tired.amount.cheek > 1.2, '疲憊 → 腮紅加強（' + tired.amount.cheek.toFixed(2) + ' 倍）');
  ok(adjustIntensity({ lip: 0.9, eye: 0.9, cheek: 0.9 }, tired.amount).cheek === 1,
     '　加強後仍夾在滑桿上限 1 以內');

  // 行程 → 妝容加權方向不同
  const pick = (c) => Object.entries(contextAdvice(c).look).sort((a, b) => b[1] - a[1])[0][0];
  ok(pick({ plan: 'meeting' }) === 'clean' && pick({ plan: 'party' }) === 'retro' && pick({ plan: 'date' }) === 'kbeauty',
     '面試 → 清透通勤、聚會 → 復古氣質、約會 → 韓系微光');

  // 情境只加權，不改膚色契合分
  const ranked = [{ look: { id: 'natural' }, score: 88 }, { look: { id: 'retro' }, score: 91 }];
  const after = rankWithContext(ranked, contextAdvice({ plan: 'errand' }));
  ok(after.every((r) => r.score === ranked.find((x) => x.look.id === r.look.id).score),
     '情境加權不會改動膚色契合分（量測與情境分開記）');
  ok(after[0].look.id === 'natural' && after[0].total === 96,
     '　加權後排序會變：88 + 8 = 96，排到復古氣質（91）前面');

  // 每一條調整都要附理由
  const full = contextAdvice({ mood: 'tired', weather: 'hot', plan: 'date' });
  ok(full.reasons.length === 3 && full.reasons.every((r) => /^ctx\.why\./.test(r.key)),
     '三項都選時，每一項各有一條可顯示的理由');

  // 表情 → 心情只是猜測
  ok(moodFromFace(null) === null, '沒有表情資料時不亂猜（回傳 null）');
  ok(moodFromFace({ mouthSmileLeft: 0.6, mouthSmileRight: 0.55 }) === 'bright', '在笑 → 猜「有精神」');
  ok(moodFromFace({ eyeBlinkLeft: 0.7, eyeBlinkRight: 0.66 }) === 'tired', '眼皮沉重 → 猜「疲憊」');
  ok(moodFromFace({}) === 'calm', '沒有明顯表情 → 猜「平靜」');

  // 天氣的外部掛勾：只吃認得的值，離線保證不破
  ok(externalWeather('?weather=hot') === 'hot' && externalWeather('?weather=typhoon') === null,
     '外部天氣只接受認得的代碼，其餘一律忽略');
}

console.log('\n\x1b[1m14. AI 顧問：有依據才說話\x1b[0m');
{
  const skinN = { itaDeg: 41.2, lab: { L: 72, a: 8, b: 14 }, residual: 1.2, undertone: 'neutral', depthKey: 'light', warnings: [] };
  const skinW = { itaDeg: 30.0, lab: { L: 66, a: 10, b: 20 }, residual: 11.4, undertone: 'warm', depthKey: 'light', warnings: [] };
  const skinD = { itaDeg: -32, lab: { L: 38, a: 12, b: 18 }, residual: 6, undertone: 'warm', depthKey: 'dark', warnings: ['warn.deep'] };
  const all = (arr) => arr.map((l) => l.key);
  const kinds = (arr) => arr.map((l) => l.kind);

  ok(all(onSkin(skinW)).includes('adv.toneClear'), '底調明確（殘差 11.4°）→ 給有依據的肯定');
  ok(all(onSkin(skinN)).includes('adv.toneVersatile'), '底調接近中性（殘差 1.2°）→ 講成「可選範圍大」，仍附數字');
  ok(kinds(onSkin(skinD)).includes('caution'), '深膚色 → 主動說明判定信心較低');

  // 低分情境：一句好話都撐不起來時，不准硬誇
  const bad = onFinish({ fit: 25, dh: 62, standout: -1.2, match: 41, gain: 3.1 }, skinN);
  ok(!kinds(bad).includes('praise'), '契合度 41、色相差 62°、存在感 −1.2 → 沒有任何一句稱讚');
  ok(kinds(bad).includes('tip'), '　但一定附上可以照做的下一步');

  // 高分情境：稱讚要出現，而且句子裡帶得出數字
  const good = onFinish({ fit: 100, dh: 12, standout: 17.9, match: 91, gain: 18.7 }, skinN);
  ok(kinds(good).filter((k) => k === 'praise').length >= 3, '契合度 91、色相差 12°、存在感 17.9 → 多句肯定');
  ok(good.filter((l) => l.kind === 'praise').every((l) => Object.keys(l.params).length > 0 || l.key === 'adv.fitAll'),
     '　每一句肯定都帶著它引用的數字');

  // 使用者換到跟底調相反的色號：照實說更搶眼，不假裝那是最佳解
  const off = onShadeChange({ id: 'L307', color: '#C0293E', tone: 'cool' }, { id: 'L204', color: '#B4553F', tone: 'warm' }, skinW);
  ok(!kinds(off).includes('praise') && kinds(off).includes('tip'), '換到相反底調 → 給建議而不是稱讚');
  ok(all(off).includes('adv.shadeGap'), '　並且說出跟前一支差多少（ΔE）');
  const same = onShadeChange({ id: 'L204', color: '#B4553F', tone: 'warm' }, null, skinW);
  ok(kinds(same).includes('praise'), '換到同底調 → 這時才給肯定');

  // 配方
  const P3 = { lip: { tone: 'warm', stock: 12 }, eye: { tone: 'warm', stock: 9 }, cheek: { tone: 'warm', stock: 14 } };
  ok(all(onPicks(P3, skinW)).includes('adv.picksAll'), '三件都對上底調 → 肯定');
  const P2 = { lip: { tone: 'cool', stock: 5 }, eye: { tone: 'neutral', stock: 9 }, cheek: { tone: 'warm', stock: 14 } };
  ok(all(onPicks(P2, skinW)).includes('adv.lowStock'), '庫存偏低 → 主動提醒');

  // 妝容
  const ranked = [{ look: { id: 'retro' }, score: 90, why: ['why.brightLip'] }, { look: { id: 'natural' }, score: 78, why: ['why.lowChroma'] }];
  ok(all(onLook(ranked, { id: 'retro' })).includes('adv.lookStrong'), '選到第一名（90 分）→ 肯定');
  ok(all(onLook(ranked, { id: 'natural' })).includes('adv.lookAlt'), '選到非第一名 → 照實說哪一款分數更高');

  // 濃度只在兩端說話
  ok(onAmount('lip', 0.55).length === 0, '濃度落在中間 → 不囉嗦');
  ok(onAmount('lip', 0.92)[0].kind === 'tip' && onAmount('lip', 0.1)[0].kind === 'tip', '濃度過高或過低 → 各給一句建議');

  // 全部句子的形狀一致，畫面才不會出現空字串或不存在的鍵
  const every = [...onSkin(skinW), ...onSkin(skinN), ...onSkin(skinD), ...bad, ...good, ...off, ...same,
                 ...onPicks(P3, skinW), ...onPicks(P2, skinW), ...onLook(ranked, { id: 'natural' }), ...onAmount('eye', 0.95)];
  ok(every.every((l) => /^adv\./.test(l.key) && KINDS.includes(l.kind) && l.params && typeof l.params === 'object'),
     '所有句子都是 { adv.* 文案鍵, 已知類別, 參數物件 }（共 ' + every.length + ' 句）');
}

console.log('\n\x1b[1m15. 現場光線的誠實提示\x1b[0m');
{
  ok(lightNote(true, false, 0.42).length === 0, '眼白量得到、光線足夠 → 不囉嗦');
  ok(lightNote(false, true, 0.42)[0].key === 'adv.lightFallback', '眼白量不到但高光可用 → 說明改用高光估光源');
  ok(lightNote(false, false, 0.42)[0].key === 'adv.lightNone', '兩種都估不出來 → 說明顏色沿用相機白平衡');
  ok(lightNote(true, true, 0.12)[0].key === 'adv.lightDark', '太暗時優先提醒光線（就算眼白量得到）');
  ok(lightNote(true, true, null).length === 0, '量不到亮度時不亂猜');
  ok(lightNote(false, false, 0.42)[0].kind === 'caution', '這類提示一律標成「留意」');
}


console.log('\n\x1b[1m16. 對話式互動：建議之後給選項\x1b[0m');
{
  const skinW = { undertone: 'warm', lab: { L: 66 }, hue: 78.4, residual: 11.4 };
  const ranked = [{ look: { id: 'retro' }, score: 90 }, { look: { id: 'natural' }, score: 78 }];
  const allOpts = [...optsForSkin(ranked, { id: 'natural' }), ...optsForPicks({ lip: { tone: 'cool' } }, skinW),
                   ...optsForAR(false), ...optsForFinish()];
  ok(allOpts.every((o) => /^opt\./.test(o.key) && ACTS.includes(o.act)),
     '每個選項都是 { opt.* 文案鍵, 已知動作 }（共 ' + allOpts.length + ' 個）');
  ok(optsForSkin(ranked, { id: 'natural' }).some((o) => o.act === 'useTop'),
     '選到的不是第一名 → 給「換成分數最高的那款」');
  ok(!optsForSkin(ranked, { id: 'retro' }).some((o) => o.act === 'useTop'),
     '選到的就是第一名 → 不給這個選項（不做多餘的建議）');
  ok(optsForPicks({ lip: { tone: 'cool' }, eye: { tone: 'warm' }, cheek: { tone: 'warm' } }, skinW).some((o) => o.act === 'toNeutral'),
     '有商品與底調相反 → 給「換成中性色」');
  ok(!optsForPicks({ lip: { tone: 'warm' }, eye: { tone: 'neutral' }, cheek: { tone: 'warm' } }, skinW).some((o) => o.act === 'toNeutral'),
     '沒有相反的 → 不給這個選項');
  ok(optsForAR(true).some((o) => o.key === 'opt.zoomOff') && optsForAR(false).some((o) => o.key === 'opt.zoom'),
     '放大開關的文字跟著目前狀態走');
  const why = explain('tone', skinW)[0];
  ok(why.key === 'adv.whyTone' && why.params.base === '63' && why.params.resid === '11.4',
     '「為什麼這樣判斷」攤開算式：L* 66 的中性基準 63°，殘差 11.4°');
  ok(explain('match', { fit: 100, dh: 16, gain: 18.7, match: 88 })[0].key === 'adv.whyMatch',
     '「這分數怎麼算的」回傳加權算式');
  ok(onAR({ shade: '#307 冷調正紅' }, 0.74)[0].key === 'adv.arIntro' && onAR(null).length === 0,
     '進 AR 先說鏡子裡是什麼；沒有商品時不亂講');
  ok(explain('tone', null).length === 0 && explain('nope', {}).length === 0, '沒有資料或不認得的題目 → 不亂編');

  // 對話不該繞回原點
  const arOpts = optsForAR(false);
  ok(dropAsked(optsForFinish(), ['whyMatch']).every((o) => o.act !== 'whyMatch'),
     '問過的「為什麼」就從選項收掉（同一題問第二次沒有新資訊）');
  ok(dropAsked(arOpts, ['whyMatch']).length === arOpts.length, '　但不會誤收其他選項');
  ok(!dropDeadAmount(arOpts, { lip: 1, eye: 1, cheek: 1 }).some((o) => o.act === 'stronger'),
     '濃度全部到頂 → 收掉「更明顯一點」');
  ok(!dropDeadAmount(arOpts, { lip: 0.15, eye: 0.15, cheek: 0.15 }).some((o) => o.act === 'softer'),
     '濃度全部到對話的下限（0.15）→ 收掉「再淡一點」');
  ok(dropDeadAmount(arOpts, { lip: 0.6, eye: 0.4, cheek: 0.5 }).length === arOpts.length,
     '中間值 → 兩個都留著');
  ok(optsForAR(false, 'bare').some((o) => o.key === 'opt.compareOff')
     && optsForAR(false, 'full').some((o) => o.key === 'opt.compare'),
     '素顏對比開著時，選項改寫成「收起」（再按一次關得掉）');
  ok(optsForAR(false, 'dual').some((o) => o.key === 'opt.dualOff')
     && optsForAR(false, 'bare').some((o) => o.key === 'opt.dual'),
     '雙色對比同理，而且兩個開關互不影響');
}

console.log('\n\x1b[1m17. 互動：AI 反問、偏好記憶、主動開口\x1b[0m');
{
  // 反問的那一題：答案要真的改得動東西，所以三個答案都在 ACTS 裡
  const q = askAmount(0.7);
  ok(q.lines[0].kind === 'ask' && q.lines[0].params.n === 70, '反問一樣掛著數字（現在的濃度 70）');
  ok(q.opts.length === 3 && q.opts.every((o) => ACTS.includes(o.act)), '三個答案都對應真的執行得了的動作');

  // 偏好：只認行為，而且證據不夠就不下結論
  const lipC = { id: 'c1', tone: 'cool' }, lipC2 = { id: 'c2', tone: 'cool' }, lipW = { id: 'w1', tone: 'warm' };
  const p = newPref();
  noteDwell(p, lipC, DWELL_MS - 1);
  ok(p.kept.length === 0 && prefTone(p) === null, `停留 ${(DWELL_MS - 1) / 1000} 秒不算數（只是滑過去）`);
  noteDwell(p, lipC, DWELL_MS + 500);
  ok(p.kept.length === 1 && prefTone(p) === null, '只停過一支 → 還不算偏好');
  noteDwell(p, lipC, DWELL_MS + 900);
  ok(p.kept.length === 1, '同一支停兩次只記一次');
  noteDwell(p, lipC2, DWELL_MS + 200);
  ok(prefTone(p) === 'cool', '兩支冷調都停下來 → 偏好成立');
  noteDwell(p, lipW, DWELL_MS + 200); noteDwell(p, { id: 'w2', tone: 'warm' }, DWELL_MS + 200);
  ok(prefTone(p) === null, '冷暖各兩支 → 打平就不下結論');

  const q2 = newPref();
  notePref(q2, 'soft'); ok(prefBias(q2) === null, '按一次「再淡一點」不算偏好');
  notePref(q2, 'soft'); ok(prefBias(q2) === 'soft', '連按兩次才算');
  notePref(q2, 'bold'); ok(prefBias(q2) === null, '一來一回 → 回到沒有偏好');

  // 換色號：有偏好時優先同底調，而且說得出依據
  const list = [{ id: 'a', tone: 'warm' }, { id: 'b', tone: 'warm' }, { id: 'c', tone: 'cool' }, { id: 'd', tone: 'cool' }];
  const cool = newPref(); noteDwell(cool, list[2], 9e3); noteDwell(cool, list[3], 9e3);
  ok(pickNext(list, 'a', newPref()).id === 'b', '沒有偏好 → 照原本的順序輪');
  ok(pickNext(list, 'a', cool).id === 'c', '偏好冷調 → 先給冷調的那一支');
  ok(pickNext(list, 'd', cool).id === 'c', '輪到最後一支會繞回來，而且不會給回自己');
  ok(prefNote(cool, list[2])[0].key === 'adv.prefTone' && prefNote(cool, list[0]).length === 0,
     '依偏好挑的時候講出依據；不是那個底調就不硬掰');

  // 記住的偏好要能一鍵照做，不然「我記得你喜歡」只是嘴上說說
  const picksWarm = { lip: { id: 'w1', tone: 'warm' }, eye: { id: 'e', tone: 'neutral' }, cheek: { id: 'k', tone: 'neutral' } };
  const picksCool = { lip: { id: 'c1', tone: 'cool' }, eye: { id: 'e', tone: 'neutral' }, cheek: { id: 'k', tone: 'neutral' } };
  ok(optsForPicks(picksWarm, { undertone: 'warm' }, cool).some((o) => o.act === 'usePref'),
     '記得偏好冷調、現在是暖調 → 給「換成我停留過的那種」');
  ok(!optsForPicks(picksCool, { undertone: 'warm' }, cool).some((o) => o.act === 'usePref'),
     '現在就是那個底調 → 不給（點了也不會變）');
  ok(!optsForPicks(picksWarm, { undertone: 'warm' }, newPref()).some((o) => o.act === 'usePref'),
     '還沒有偏好 → 不給');
  ok(prefRecall(cool, picksWarm)[0].key === 'adv.prefRecall' && prefRecall(newPref(), picksWarm).length === 0,
     '回到配方畫面會把記住的偏好講出來；沒記到就不講');
  ok(prefRecall(cool, picksCool).length === 0, '唇色已經是那個底調 → 閉嘴（沒有答案的問題不要問）');

  // 主動開口：一種情況一場只講一次，而且要有數字
  const base = { idleMs: 0, tried: 1, lipPct: 14, curDe: 30, said: new Set() };
  ok(observe({ ...base }) === null, '有人正在操作 → 不插話');
  ok(observe({ ...base, lipPct: 6 }).id === 'tooFar', '唇只佔畫面寬 6% → 提醒靠近一點');
  ok(observe({ ...base, lipPct: 6, said: new Set(['tooFar']) }) === null, '講過的就不再講');
  const best = { shade: '#307 冷調正紅', de: 31.4 };
  const ask = observe({ ...base, idleMs: 13e3, tried: 3, best });
  ok(ask.id === 'askBest' && ask.lines[0].kind === 'ask' && ask.opts.length === 2,
     '閒著 13 秒又試過 3 支 → 反問「要不要換成對比最大的那支」');
  ok(observe({ ...base, idleMs: 13e3, tried: 2, best }) === null, '只試過 2 支 → 還沒有東西好比，不問');
  ok(observe({ ...base, idleMs: 21e3 }).id === 'idleTry', '閒著 21 秒 → 給一個帶數字的下一步');

  // 收尾：引用真的發生過的事，沒發生的不掰
  const sum = sessionSummary({ tried: 4, shade: '#307', amount0: 0.92, amount1: 0.6, pref: cool });
  ok(sum.map((l) => l.key).join() === 'adv.sumTried,adv.sumAmount,adv.sumTone',
     '收尾講：試了幾支、濃度自己調了多少、停留過的底調');
  ok(sum.every((l) => l.kind === 'fact'), '收尾是陳述，不是再誇一次');
  const none = sessionSummary({ tried: 1, shade: '#307', amount0: 0.7, amount1: 0.7, pref: newPref() });
  ok(none.length === 0, '只試一支、濃度沒動、沒有偏好 → 一句都不講');
}

console.log('\n\x1b[1m18. 對話不會走進死路 + 情境三題\x1b[0m');
{
  // 還沒選妝容時問完「為什麼」→ 不能變成沒有選項（實際發生過的當機情境）
  const s2 = optsForSkin([{ look: { id: 'clean' }, score: 90 }], null);
  ok(s2.some((o) => o.act === 'whyTone') && s2.some((o) => o.act === 'useTop'),
     '還沒選妝容時，除了「為什麼」也給一條往前的路');
  ok(dropAsked(s2, ['whyTone']).length >= 1, '　問完「為什麼」之後仍然有得點');
  const s5 = dropAsked(optsForFinish(), ['whyMatch']);
  ok(s5.length >= 1 && s5[0].act === 'retry', '回饋畫面問完「這分數怎麼算的」也還有退路');

  // 一次性的答案：答完就收掉，不會累積在選項列
  const mixed = [...optsForAR(false, 'full'), { key: 'opt.prefSoft', act: 'prefSoft' },
                 { key: 'opt.ctxYes', act: 'ctxMood' }];
  ok(dropAnswers(mixed).length === optsForAR(false, 'full').length,
     '回答用的選項是一次性的，答完就收掉');
  ok(dropAnswers(optsForAR(false, 'full')).length === optsForAR(false, 'full').length,
     '　但不會誤收平常的動作');

  // 情境三題：量不到的事用問的，答案標成「你說的」
  const items = MOODS.map((id) => ({ id, key: 'ctx.mood.' + id }));
  const plain = askContext('mood', items, null);
  ok(plain.lines[0].kind === 'ask' && plain.lines[0].key === 'adv.askmood', '沒有猜測時直接問');
  ok(plain.opts.length === MOODS.length + 1 && plain.opts.every((o) => ACTS.includes(o.act)),
     `四個心情 + 一個「不想說」，動作都在 ACTS 裡`);
  ok(plain.opts.every((o) => o.act === 'ctxSkip' || o.val), '每個答案都帶著它代表的選項值');
  const guessed = askContext('mood', items, 'tired');
  ok(guessed.lines[0].key === 'adv.askmoodGuess' && guessed.lines[0].params.guess === 'ctx.mood.tired',
     '表情猜到了 → 改成「我猜是這個，對嗎」而不是直接當成事實');
  ok(guessed.opts[0].key === 'opt.ctxYes' && guessed.opts[0].val === 'tired',
     '　第一個選項是「對，就是這個」');
  ok(guessed.opts.filter((o) => o.val === 'tired').length === 1, '　猜到的那一個不會重複出現兩次');
  ok(askContext('plan', PLANS.map((id) => ({ id, key: 'ctx.plan.' + id })), null).opts.length === PLANS.length + 1,
     '行程同樣是「所有選項 + 不想說」');

  const got = onContext('mood', 'ctx.mood.tired', 'ctx.why.tired');
  ok(got[0].kind === 'told' && KINDS.includes('told'),
     '情境的回答標成「你說的」—— 跟量出來的分開（可信度不一樣）');
  ok(got[0].params.why === 'ctx.why.tired', '　而且附上「因為你這樣說，所以怎麼調」');
  ok(onContext('mood', null)[0].key === 'adv.ctxSkipped', '不想說 → 照實說這一項不列入');
}

console.log('\n\x1b[1m19. 追問：解釋不是死路，可以一路問下去\x1b[0m');
{
  const s2 = optsAfterWhy('s2'), s5 = optsAfterWhy('s5');
  ok(s2.length === 3 && s5.length === 3, '膚色與分數各給三個追問');
  ok([...s2, ...s5].every((o) => ACTS.includes(o.act) && EXPLAIN_ACTS.includes(o.act)),
     '追問都是已知動作，而且都算「問過就收掉」的那一類');
  ok(dropAsked([...s2, { key: 'opt.useTop', act: 'useTop' }], ['whyDepth', 'whyLight']).length === 2,
     '問過的追問收掉，往前的路留著');

  const skin = classifySkin(hexRgb('#f0d7c2'));
  const band = [{ min: 55, key: 'very-light' }].find((c) => skin.itaDeg > c.min) || { min: 41 };
  const dep = explain('depth', { ...skin, band })[0];
  ok(dep.key === 'adv.whyDepth' && dep.params.depth === 'depth.' + skin.depthKey && +dep.params.ita === +skin.itaDeg.toFixed(1),
     `深淺的追問報出實際的 ITA°（${skin.itaDeg.toFixed(1)}°）與它落在的帶`);

  const lit = explain('light', { reliable: true, samples: 762, cct: 5709.4 })[0];
  ok(lit.key === 'adv.whyLight' && lit.params.n === 762 && lit.params.cct === 5709,
     '光線的追問報出眼白取樣點數與估到的色溫');
  const dark = explain('light', { reliable: false, samples: 12 })[0];
  ok(dark.key === 'adv.whyLightNo' && dark.kind === 'caution',
     '眼白量不到 → 照實說判定會比較不穩，而且標成「留意」');

  const pick = explain('pick', { total: 5, n: 3, tone: 'cool' })[0];
  ok(pick.params.total === 5 && pick.params.n === 3, '「這跟推薦有什麼關係」用的是櫃上真的有貨的支數');

  const v = { fit: 100, harmony: 73, done: 74, match: 84, dh: 16.2, gain: 28.3, want: 19.6, standout: 26.2,
              band: { id: 'band.clear' } };
  ok(explain('hue', v)[0].params.n === 73 && explain('hue', v)[0].params.dh === '16', '色相差的追問給出算式與結果');
  ok(explain('level', v)[0].params.diff === '8.7', '上妝幅度的追問算出離期望值多遠');
  ok(explain('standout', v)[0].params.band === 'band.clear.say', '存在感的追問報出它落在的級距');

  ok(['depth', 'light', 'pick', 'hue', 'level', 'standout'].every((k) => explain(k, null).length === 0),
     '沒有資料的追問一律不回答，不亂編');
}

console.log('\n\x1b[1m20. 互動方式：點鏡子、圈回臉上、點頭搖頭\x1b[0m');
{
  // 點鏡子裡的臉：最近而且在範圍內才算
  const anchors = [{ kind: 'lip', x: 100, y: 200, r: 40 }, { kind: 'eye', x: 100, y: 100, r: 30 },
                   { kind: 'cheek', x: 160, y: 160, r: 30 }];
  ok(nearestRegion({ x: 105, y: 205 }, anchors) === 'lip', '點在唇附近 → 唇');
  ok(nearestRegion({ x: 100, y: 108 }, anchors) === 'eye', '點在眼附近 → 眼');
  ok(nearestRegion({ x: 400, y: 400 }, anchors) === null, '點在很遠的地方 → 不亂猜（回 null）');
  const twin = [{ kind: 'lip', x: 0, y: 0, r: 50 }, { kind: 'cheek', x: 60, y: 0, r: 50 }];
  ok(nearestRegion({ x: 40, y: 0 }, twin) === 'cheek', '兩個範圍重疊時 → 取比較近的那一個');
  ok(nearestRegion({ x: 0, y: 0 }, []) === null && nearestRegion({ x: 0, y: 0 }, null) === null,
     '沒有臉的時候不會炸掉');

  // 點了之後講那個部位量到什麼
  const lipLine = onRegion('lip', { shade: '#307', amount: 0.92, de: 63.62 })[0];
  ok(lipLine.key === 'adv.regLip' && lipLine.params.n === 92 && lipLine.params.de === '63.6',
     '點唇 → 報出色號、濃度與色卡跟膚色的差');
  const skinLine = onRegion('skin', { itaDeg: 72.34, lab: { L: 74.2 }, undertone: 'cool', patches: 10 })[0];
  ok(skinLine.params.n === 10 && skinLine.params.ita === '72.3',
     '點臉 → 報出量膚色的那幾塊與 ITA°（圈起來的就是量的地方）');
  ok(onRegion('lip', null).length === 0 && onRegion('nope', {}).length === 0, '沒有資料或不認得的部位 → 不亂講');

  // 點頭／搖頭
  const buf = (fn) => { const now = 1e6, out = [];
    for (let i = 0; i < 42; i++) out.push({ t: now - 1400 + i * 33, ...fn(i) });
    return out; };
  const wave = (i) => 0.05 * Math.sin((i / 42) * 4 * Math.PI);      // 1400ms 內來回兩次
  ok(readGesture(buf((i) => ({ x: 0, y: wave(i) })), 1e6) === 'nod', '上下來回兩次 → 點頭');
  ok(readGesture(buf((i) => ({ x: wave(i), y: 0 })), 1e6) === 'shake', '左右來回兩次 → 搖頭');
  ok(readGesture(buf(() => ({ x: 0, y: 0 })), 1e6) === null, '完全不動 → 不算');
  ok(readGesture(buf((i) => ({ x: 0, y: i * 0.004 })), 1e6) === null,
     '慢慢低頭（幅度夠但沒有來回）→ 不算，不然低頭看商品就被當成點頭');
  ok(readGesture(buf((i) => ({ x: 0, y: 0.01 * Math.sin((i / 42) * 4 * Math.PI) })), 1e6) === null,
     '幅度太小的晃動 → 不算');
  ok(readGesture(buf((i) => ({ x: wave(i), y: wave(i) })), 1e6) === null,
     '兩軸幅度差不多（畫圈）→ 分不出是點頭還是搖頭，就不猜');
  ok(readGesture([{ t: 1e6, x: 0, y: 0 }], 1e6) === null, '樣本太少 → 不判定');

  // 停在同一支夠久 → 問要不要留（是非題，所以手勢派得上用場）
  const keep = observe({ idleMs: 11e3, dwellMs: 11e3, curShade: '#307', curId: 'L307',
                         tried: 2, lipPct: 14, curDe: 30, said: new Set() });
  ok(keep.id === 'askKeep:L307' && keep.yesNo === true && keep.opts.length === 2,
     '停留 11 秒又沒動作 → 問「要留這支嗎」，而且標成是非題');
  ok(observe({ idleMs: 11e3, dwellMs: 11e3, curShade: '#307', curId: 'L307', tried: 2, lipPct: 14,
               curDe: 30, said: new Set(['askKeep:L307']) })?.id !== 'askKeep:L307',
     '同一支只問一次');
  ok(observe({ idleMs: 2e3, dwellMs: 11e3, curShade: '#307', curId: 'L307', tried: 2, lipPct: 14,
               curDe: 30, said: new Set() }) === null, '還在操作就不插話（就算停留很久）');
}

console.log('\n\x1b[1m21. 臉型：分類、推薦理由、白話說法\x1b[0m');
{
  // 每一種臉型的典型值 → 分到自己
  ok(FACE_SHAPES.every((s) => classifyFace(PROTOTYPES[s]).shape === s), '六種臉型的典型比例各自分回自己');

  const base = { ...PROTOTYPES.oval };
  ok(classifyFace({ ...base, R: 1.75, jr: 0.86 }).shape === 'oblong', '臉長拉到 1.75 倍、下顎變寬 → 長臉');
  ok(classifyFace({ ...base, R: 1.1, jr: 0.91, jawDeg: 127 }).shape === 'square', '臉短、下顎寬又有角 → 方形臉');
  ok(classifyFace({ ...base, R: 1.12, jr: 0.8, jawDeg: 146, taper: 0.63 }).shape === 'round', '臉短、下顎圓 → 圓臉');
  ok(classifyFace({ ...base, fr: 1.04, jr: 0.7, taper: 0.46 }).shape === 'heart', '額頭最寬、下巴尖 → 心形臉');

  // 測試臉實際量到的特徵：落在鵝蛋臉與長臉交界，應該照實講「介於兩者之間」
  const cam = classifyFace({ R: 1.576, fr: 0.955, jr: 0.773, taper: 0.554, jawDeg: 138.8 });
  ok(cam.between && [cam.shape, cam.second].sort().join() === 'oblong,oval',
     `測試臉（長寬比 1.58）→ 介於鵝蛋臉和長臉之間，不硬選一個（差距 ${cam.margin.toFixed(2)}）`);
  ok(classifyFace({ R: 5, fr: 3, jr: 0.1, taper: 2, jawDeg: 20 }).unsure, '量出來的比例完全不像人臉（側臉、遮擋）→ 不給結論');
  ok(classifyFace(null) === null, '沒有特徵 → 不亂猜');

  // 臉型要真的影響推薦，而不只是說明
  const ovalBonus = faceLookBonus(classifyFace(PROTOTYPES.oval));
  ok(ovalBonus.kbeauty > (ovalBonus.clean || 0) && ovalBonus.kbeauty >= 10,
     `鵝蛋臉 → 韓系微光加 ${ovalBonus.kbeauty} 分（量級要跟膚色分數的差距相當，才推得動排序）`);
  ok(Object.keys(faceLookBonus({ unsure: true })).length === 0, '臉型量不準 → 完全不加分');
  const mixed = faceLookBonus(cam);
  ok(mixed.natural > 0 && mixed.kbeauty > 0, '介於兩者之間 → 兩種臉型各自適合的妝都加一點，不全押一邊');

  const r1 = faceReasonFor(cam, 'natural'), r2 = faceReasonFor({ shape: 'round', second: 'oval' }, 'kbeauty');
  ok(r1 && r1.key.startsWith('face.why.'), '這款襯臉型時，講得出是襯哪一種');
  ok(r2 && r2.shape === 'oval', '第一名臉型沒有理由時，改用第二名 —— 而且講出來的是第二名的臉型，不張冠李戴');
  ok(faceReasonFor({ shape: 'heart', second: 'oblong' }, 'clean') === null, '兩種臉型都跟這款無關 → 不硬掰理由');

  // 白話說法：主要說辭不塞數字，數字留在「臉型是怎麼看的」
  const skinC = classifySkin(hexRgb('#f0d7c2'));
  const ranked = [{ look: { id: 'natural' }, score: 78 }, { look: { id: 'retro' }, score: 90 }];
  const plain = [...plainFace(cam), ...plainSkin(skinC), ...plainBlush(cam),
                 ...plainLook(ranked, { id: 'retro' }, cam, skinC), ...plainCeleb(cam)];
  const hasNumber = (l) => Object.values(l.params).some((v) => typeof v === 'number' || /\d/.test(String(v).replace(/^[a-z.]+$/i, '')));
  ok(plain.length >= 5 && !plain.some((l) => l.key.startsWith('adv.p.') && l.key !== 'adv.p.celeb' && hasNumber(l)),
     '推薦畫面的主要說辭（臉型、膚色、腮紅、為什麼適合）都不帶數字');
  ok(plainFace(cam)[0].key === 'adv.p.faceBetween', '分不太開時，第一句就是「介於兩者之間」');
  ok(plainLook(ranked, { id: 'retro' }, cam, skinC).some((l) => l.key === 'adv.p.lookAlt'),
     '選的不是第一名 → 照實說哪一款更襯');
  const why = explain('face', { f: { R: 1.576, fr: 0.955, jr: 0.773, taper: 0.554, estimated: true }, cls: cam });
  ok(why[0].params.R === '1.58' && why[0].params.fr === 96 && why.some((l) => l.key === 'adv.p.faceEst'),
     '數字在追問裡：長寬比 1.58、額頭 96%；髮際線用估的要照實講');

  // 明星例子：多份清單一致才收，而且同一個人不能出現在兩種臉型
  const all = Object.values(CELEBS).flatMap((c) => [...c.f, ...c.m]);
  ok(FACE_SHAPES.every((s) => CELEBS[s]?.f?.length >= 2), '每種臉型至少兩位女星例子');
  ok(all.every((c) => c.name && c.name_en && c.name_ja), '三種語言的名字都有');
  ok(new Set(all.map((c) => c.name_en)).size === all.length, '沒有人同時被列在兩種臉型（有爭議的就不收）');
  ok(plainCeleb({ unsure: true }).length === 0, '臉型量不準 → 不舉例');

  // 用詞：不說修飾、顯瘦、小臉、缺點（臉型分類表的原始前提就是「修成鵝蛋臉」，這台機器不採用）
  const dict = readFileSync(new URL('./js/i18n.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => /'(face\.|adv\.p\.|look\.cardFace|why\.)/.test(l));
  const banned = ['修飾', '顯瘦', '小臉', '缺點', '顯臉小', 'slim', 'flaw', '欠点', '小顔'];
  const hits = dict.filter((l) => banned.some((w) => l.includes(w)));
  ok(dict.length > 60 && hits.length === 0, `臉型相關的 ${dict.length} 條文案沒有修飾／顯瘦／小臉這類說法`);
}

console.log('\n\x1b[1m22. 對話的表情符號\x1b[0m');
{
  const plainActs = ACTS.filter((a) => !/^ctx(Mood|Weather|Plan)$/.test(a));
  ok(plainActs.every((act) => optEmoji({ act, key: 'opt.' + act })), `每個快速回覆都有表情符號（${plainActs.length} 種動作）`);
  const ctxOpts = [...MOODS.map((v) => ({ act: 'ctxMood', val: v })), ...WEATHERS.map((v) => ({ act: 'ctxWeather', val: v })),
                   ...PLANS.map((v) => ({ act: 'ctxPlan', val: v }))];
  ok(ctxOpts.every((o) => optEmoji(o) && optEmoji(o) !== '💬'), '心情、天氣、行程的每個答案都有自己的符號');
  ok(optEmoji({ key: 'opt.ctxYes', act: 'ctxMood', val: 'tired' }) === '👍', '「對，就是這個」用 👍，不是那個心情的符號');

  const skinC = classifySkin(hexRgb('#f0d7c2'));
  const cls = classifyFace(PROTOTYPES.oval);
  const lines = [...plainFace(cls), ...plainSkin(skinC), ...plainBlush(cls), ...plainCeleb(cls),
                 ...onPicks({ lip: { tone: 'cool', stock: 3 }, eye: { tone: 'cool', stock: 9 }, cheek: { tone: 'neutral', stock: 9 } }, skinC),
                 ...askAmount(0.7).lines, ...lightNote(false, false, 0.1), ...onAR({ shade: '#307' }, 0.7)];
  ok(lines.every((l) => lineEmoji(l)), `每一句都配得到符號（抽查 ${lines.length} 句）`);
  ok(lineEmoji({ key: 'adv.p.face', kind: 'fact' }) === '✨' && lineEmoji({ key: 'adv.p.skin.cool', kind: 'fact' }) === '🌸',
     '臉型 ✨、膚色 🌸');
  ok(lineEmoji({ key: 'adv.p.faceEst', kind: 'caution' }) === '🙏', '「只能當大概參考」這類留意，用 🙏 而不是嚇人的 ⚠️');

  // 不用「在說你很好看」的符號 —— 跟「不評價長相」同一個立場
  const src = readFileSync(new URL('./js/emoji.js', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  const banned = ['😍', '🥰', '😘', '👑', '🔥', '💋', '⚠️'];
  ok(!banned.some((e) => src.includes(e)), '對照表裡沒有 😍🥰😘👑🔥💋⚠️');
}

console.log('\n\x1b[1m23. 不只推薦給女性：男士妝容\x1b[0m');
{
  const q = askAudience();
  ok(q.lines[0].kind === 'ask' && q.opts.length === 3 && q.opts.every((o) => ACTS.includes(o.act) && optEmoji(o)),
     '用問的：女性／男性／都可以，三個答案都是已知動作、都有符號');

  const men = LOOKS.find((l) => l.id === 'men');
  ok(men && men.audience === 'men' && Math.max(men.intensity.lip, men.intensity.eye, men.intensity.cheek) <= 0.25,
     '有一款清爽男士妝，三個部位濃度都壓在 0.25 以下（看不出上妝）');
  ok(['cool', 'warm', 'neutral'].every((u) => Object.values(resolveLook(men, u)).every((p) => p.tone === 'neutral')),
     '不管哪種膚色，男士妝容三個部位都挑中性色（冷調膚色不會被配到正紅唇）');

  const skinC = classifySkin(hexRgb('#f0d7c2'));
  const order = (aud) => rankLooks(LOOKS, skinC)
    .map((r) => ({ id: r.look.id, total: r.score + (audienceBonus(LOOKS, aud)[r.look.id] || 0) }))
    .sort((x, y) => y.total - x.total).map((r) => r.id);
  ok(order('men')[0] === 'men', '選「男性妝容」→ 第一名是清爽男士妝');
  ok(order('women').at(-1) === 'men', '選「女性妝容」→ 男士妝容排到最後');
  ok(Object.keys(audienceBonus(LOOKS, 'any')).length === 0, '選「都可以」或沒回答 → 排序完全不動');
  ok(order('men').indexOf('natural') < order('men').indexOf('retro'), '男性妝容下，男女都適合的偽素顏排在正紅唇的復古妝前面');

  const oval = classifyFace(PROTOTYPES.oval);
  const names = (aud) => (plainCeleb(oval, aud)[0]?.params.names || []).map((n) => n.name_en);
  ok(names('men').join() === 'George Clooney', '看男士妝容 → 舉男星（鵝蛋臉：喬治·克隆尼）');
  ok(names('women').length === 2 && !names('women').includes('George Clooney'), '看女性妝容 → 舉女星');
  ok(names('any').length === 2 && names('any').includes('George Clooney'), '都可以 → 女星、男星各一位');
  ok(plainCeleb(classifyFace(PROTOTYPES.diamond), 'men').length === 0, '菱形臉沒有夠可靠的男星例子 → 不硬湊');

  const ranked = rankLooks(LOOKS, skinC).map((r) => ({ look: r.look }));
  ok(plainLook([{ look: men }, ...ranked], men, oval, skinC)[0].key === 'adv.p.lookMen', '推薦男士妝容時講的是男士妝容的理由');
  ok(plainGroom()[0].key === 'adv.p.groom', '男士的小技巧講整理（眉毛、遮瑕），不講腮紅');
}

console.log('\n\x1b[1m24. AI 自動判斷先排哪一類妝容\x1b[0m');
{
  ok(audienceFromPrediction({ gender: 'female', genderProbability: 0.94 }) === 'women', '女性、把握度 94% → 先排女性妝容');
  ok(audienceFromPrediction({ gender: 'male', genderProbability: 0.9 }) === 'men', '男性、把握度 90% → 先排男性妝容');
  ok(audienceFromPrediction({ gender: 'male', genderProbability: 0.84 }) === null, `把握度 84%（門檻 ${GENDER_MIN_PROB * 100}%）→ 不猜，改用問的`);
  ok(audienceFromPrediction(null) === null && audienceFromPrediction({ gender: 'x', genderProbability: 0.99 }) === null,
     '沒有結果或看不懂的結果 → 不猜');

  // 臉的裁切框：正方形、留邊、不超出照片
  const pts = [{ x: 0.40, y: 0.30 }, { x: 0.60, y: 0.30 }, { x: 0.50, y: 0.70 }];
  const b = faceCropBox(pts, 720, 540);
  ok(b.size > 0.4 * 540 && b.x >= 0 && b.y >= 0 && b.x + b.size <= 720 && b.y + b.size <= 540,
     `正方形裁切框留邊而且不超出照片（${b.size}px @ ${b.x},${b.y}）`);
  const edge = faceCropBox([{ x: 0.0, y: 0.0 }, { x: 0.3, y: 0.5 }], 400, 300);
  ok(edge.x === 0 && edge.y === 0 && edge.size <= 300, '臉貼在照片角落時，框會推回照片內');
  ok(faceCropBox([], 100, 100) === null, '沒有關鍵點 → 不裁');

  const g = askAudienceGuess('men');
  ok(g.lines[0].key === 'adv.askAudGuess.men' && g.lines[0].kind === 'ask', '套用時一定照實說「AI 自動判斷，不一定準」，並當成問題');
  ok(g.opts.map((o) => o.act).join() === 'audKeep,audWomen,audAny,whyAud', '選項：就這樣／換成另一類／都可以／AI 怎麼判斷的');
  ok(g.opts.every((o) => ACTS.includes(o.act) && optEmoji(o)), '　全部是已知動作、都有符號');
  ok(askAudienceGuess('women').opts[1].act === 'audMen', '猜女性時，換的選項是男性妝容');

  const zh = readFileSync(new URL('./js/i18n.js', import.meta.url), 'utf8').split('\n').filter((l) => /'adv\.askAudGuess\./.test(l)).join('\n');
  ok(/不一定準/.test(zh) && !/你是男|你是女/.test(zh), '文案講「先排哪一類妝容、不一定準」，不說「你是男性／女性」');
}

console.log('\n\x1b[1m25. 新手引導與「建議而不是斷言」的說法\x1b[0m');
{
  const q = askLevel();
  ok(q.lines[0].kind === 'ask' && q.opts.length === 3 && q.opts.every((o) => ACTS.includes(o.act) && optEmoji(o)),
     '問「平常有在化妝嗎」：三個答案都是已知動作、都有符號');

  const b = levelBonus(LOOKS, 'new');
  const light = LOOKS.filter((l) => Math.max(l.intensity.lip, l.intensity.eye, l.intensity.cheek) <= 0.55);
  const heavy = LOOKS.filter((l) => Math.max(l.intensity.lip, l.intensity.eye, l.intensity.cheek) >= 0.85);
  ok(light.every((l) => b[l.id] > 0) && heavy.every((l) => b[l.id] < 0),
     '第一次化妝 → 清淡好上手的加分、最濃的扣分（但仍在清單裡，不是不給）');
  ok(Object.keys(levelBonus(LOOKS, 'often')).length === 0, '常化妝 → 排序不動');
  const some = levelBonus(LOOKS, 'some');
  ok(light.every((l) => some[l.id] > 0 && some[l.id] < b[l.id]), '偶爾化妝 → 同方向但幅度只有一半');

  ok(['s2', 's3', 's4', 's5'].every((w) => levelTip('new', w)[0]?.kind === 'tip'), '第一次的人，四個步驟各有一句可以照做的提醒');
  ok(levelTip('often', 's3').length === 0 && levelTip(null, 's3').length === 0, '常化妝或還沒回答 → 不囉嗦');

  // 說法是建議，不是斷言：掃推薦畫面會講出來的中文文案
  const lines = readFileSync(new URL('./js/i18n.js', import.meta.url), 'utf8').split('\n')
    .filter((l) => /^\s*'(adv\.p\.|adv\.ctxDone|adv\.lvl|look\.best|look\.cardFace|why\.)/.test(l));
  const absolute = ['最適合', '一定', '必須', '絕對', '保證', '最好看', '就是要'];
  const hits = lines.filter((l) => absolute.some((w) => l.includes(w)));
  ok(lines.length > 25 && hits.length === 0, `推薦說法的 ${lines.length} 條文案沒有「最適合／一定／必須／絕對／保證」這類斷言`);
  ok(/可以從/.test(lines.find((l) => /adv\.p\.lookFace/.test(l)) || ''), '推薦妝容用「可以從…開始看看」，不是「推薦你用這款」');
}

console.log('\n\x1b[1m26. AI 引導流程：調整時給方向、體驗完推薦商品\x1b[0m');
{
  const key = (l) => l[0]?.key;
  ok(key(adjustHint('lip', 0.8, { plan: 'work' })) === 'adv.dir.workHigh', '行程是上班、濃度 80 → 建議稍微往左');
  ok(key(adjustHint('lip', 0.3, { plan: 'party' })) === 'adv.dir.partyLow', '晚上聚會、濃度 30 → 建議往右一點');
  ok(key(adjustHint('lip', 0.8, {}, 'new')) === 'adv.dir.newHigh', '第一次化妝、濃度 80 → 提醒可能有點明顯');
  ok(['adv.dir.low', 'adv.dir.mid', 'adv.dir.clear', 'adv.dir.high'].every((k, i) =>
       key(adjustHint('lip', [0.2, 0.5, 0.75, 0.95][i], {})) === k), '沒有行程時依濃度分四段給方向');
  ok([0.2, 0.5, 0.8, 0.95].every((v) => DIR_KEYS.includes(key(adjustHint('lip', v, { plan: 'work' }))) && adjustHint('lip', v)[0].kind === 'tip'),
     '方向提示都是「建議」，而且都在同一組可被取代的文案裡（不會越疊越多）');

  const lips = PRODUCTS.filter((p) => p.cat === 'lip');
  const red = lips.find((p) => p.id === 'L307'), nude = lips.find((p) => p.id === 'L455');
  const w = shadeHint(red, lips, { plan: 'work' });
  ok(w[0]?.key === 'adv.dir.shadeWork' && lips.find((p) => p.id === w[0].params.shade).stock > 0,
     `上班換到正紅 → 提一支柔和、有貨的（${w[0]?.params.shade}）`);
  ok(shadeHint(nude, lips, { plan: 'party' })[0]?.key === 'adv.dir.shadeParty', '聚會換到裸色 → 提一支比較有存在感的');
  ok(shadeHint(nude, lips, { plan: 'work' }).length === 0 && shadeHint(red, lips, { plan: 'party' }).length === 0,
     '跟行程方向一致時不多嘴');

  const picks = resolveLook(LOOKS.find((l) => l.id === 'natural'), 'cool');
  const nb = buyAdvice(picks, 'new'), ab = buyAdvice(picks, 'often');
  ok(nb.lines.some((l) => l.key === 'adv.buy.new') && ab.lines.some((l) => l.key === 'adv.buy.all'),
     '第一次化妝建議先帶唇彩一件；其他人可以整組');
  ok(nb.lines[0].params.lip === picks.lip.id, '推的是今天試過的那組，不是另外挑別的');
  ok(nb.opts.every((o) => ACTS.includes(o.act) && optEmoji(o)), '購買選項都是已知動作、都有符號');
}

console.log('\n\x1b[1m27. 色卡校正（ZOZOGLASS 的做法）\x1b[0m');
{
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const enc = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };
  // 模擬「櫃位燈光 × 鏡頭色偏 × 曝光」：暖光、通道之間串色、稍暗，再加 ±1% 雜訊
  // 雜訊按比例（±1%）再加一點底噪：固定 ±1% 對暗色塊來說遠比真實鏡頭誇張
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const camera = (rgb, light, cross, expo) => {
    const l = rgb.map(lin).map((v, i) => v * light[i] * expo);
    return cross.map((row) => { const v = row[0] * l[0] + row[1] * l[1] + row[2] * l[2]; return enc(v * (1 + rnd() * 0.02) + rnd() * 0.002); });
  };
  const CROSS = [[0.86, 0.12, 0.02], [0.06, 0.88, 0.06], [0.02, 0.12, 0.86]];
  const LIGHTS = { '鹵素 2700K': [1.25, 0.95, 0.52], '暖白 LED 3500K': [1.12, 0.98, 0.72], '冷白 6500K': [0.95, 1.0, 1.08], '日光燈偏綠': [0.92, 1.1, 0.9] };
  const labOf = (rgb) => rgbToLab(...rgb);
  const ref = CHART24.map((c) => c.slice(1));
  const meanDE = (obs, M) => ref.reduce((s, r, i) => s + deltaE(labOf(M ? applyCCM(obs[i], M) : obs[i]), labOf(r)), 0) / ref.length;

  const rows = [];
  let allBetter = true, ccmOk = true;
  for (const [name, light] of Object.entries(LIGHTS)) {
    const obs = ref.map((r) => camera(r, light, CROSS, 0.85));
    const ccm = fitCCM(obs), gain = fitGainOnly(obs);
    const raw = meanDE(obs), g = meanDE(obs, gain.M), c = meanDE(obs, ccm.M);
    rows.push(`  ${name.padEnd(14)} 未校正 ΔE ${raw.toFixed(1).padStart(5)}　只用白色（像眼白）${g.toFixed(1).padStart(5)}　色卡矩陣 ${c.toFixed(1).padStart(5)}`);
    if (!(c < g && g < raw)) allBetter = false;
    if (!(c < 4)) ccmOk = false;
  }
  console.log(rows.join('\n'));
  ok(allBetter, '四種燈光下都是：色卡矩陣 < 只用白色 < 不校正（色差由小到大）');
  ok(ccmOk, '色卡矩陣校正後，24 塊平均色差都在 ΔE 4 以內');

  // 真正要的是膚色：比「膚色色差」與「色相誤差」—— 不比「底調判對幾個」。
  // 判對幾個在門檻（±5°）附近只是雜訊：偏差 ΔE 5 的方法可能剛好落在門檻內「猜對」，
  // 偏差 ΔE 0.5 的方法反而因為樣本正好卡在 −5.0° 而翻到另一邊。
  const SKINS = [[232, 200, 174], [224, 184, 160], [198, 150, 120], [176, 128, 102], [150, 104, 82], [120, 84, 66]];
  let dC = 0, dG = 0, hC = 0, hG = 0, n = 0;
  for (const light of Object.values(LIGHTS)) {
    const obs = ref.map((r) => camera(r, light, CROSS, 0.85));
    const ccm = fitCCM(obs), gain = fitGainOnly(obs);
    for (const sk of SKINS) {
      const truth = classifySkin(sk), seen = camera(sk, light, CROSS, 0.85);
      const c = applyCCM(seen, ccm.M), g = applyCCM(seen, gain.M);
      dC += deltaE(labOf(c), labOf(sk)); dG += deltaE(labOf(g), labOf(sk));
      hC += Math.abs(classifySkin(c).residual - truth.residual); hG += Math.abs(classifySkin(g).residual - truth.residual);
      n++;
    }
  }
  console.log(`  膚色（6 種 × 4 種燈光）：色卡矩陣 平均 ΔE ${(dC / n).toFixed(1)}、色相誤差 ${(hC / n).toFixed(1)}°　只用白色 ΔE ${(dG / n).toFixed(1)}、${(hG / n).toFixed(1)}°`);
  ok(dC / n < dG / n / 2, '膚色色差：色卡矩陣不到只用白色的一半');
  ok(hC / n < hG / n, '膚色的色相誤差（底調判定依據）：色卡矩陣比只用白色小');

  // 過曝的色塊不採用；可用的太少就不硬擬合
  const obs = ref.map((r) => camera(r, [1, 1, 1], CROSS, 1));
  const blown = obs.map((o) => o.map((v) => Math.min(255, v + 60)));
  const fitBlown = fitCCM(blown);
  ok(!fitBlown || fitBlown.used < 24, '過曝（≥250）的色塊不採用');
  ok(fitCCM(obs.map((o, i) => (i < 5 ? o : null))) === null, '可用色塊少於 8 塊 → 不擬合，交給眼白／高光');

  // 色卡四角 → 24 個中心點
  const c = patchCenters([{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.1 }, { x: 0.7, y: 0.5 }, { x: 0.1, y: 0.5 }]);
  ok(c.length === 24 && Math.abs(c[0].x - 0.15) < 1e-9 && Math.abs(c[0].y - 0.15) < 1e-9 && Math.abs(c[23].x - 0.65) < 1e-9,
     '四個角 → 6×4 個色塊中心（左上第一塊在 0.15,0.15）');

  // 從「畫面」讀色卡：鏡像後的暖光畫面，店員亂序點四個角
  const W = 600, H = 400, X0 = 100, Y0 = 100, CELL = 50;
  const warmObs = ref.map((r) => camera(r, LIGHTS['鹵素 2700K'], CROSS, 0.85));
  const pixel = (x, y) => {
    const col = Math.floor((x - X0) / CELL), row = Math.floor((y - Y0) / CELL);
    if (col < 0 || col > 5 || row < 0 || row > 3) return [40, 48, 60];
    return warmObs[row * 6 + (5 - col)];            // 左右翻轉：深膚色那塊出現在右上
  };
  const fakeCanvas = { width: W, height: H, getContext: () => ({
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const p = pixel(x + i, y + j), k = (j * w + i) * 4;
        data[k] = p[0]; data[k + 1] = p[1]; data[k + 2] = p[2]; data[k + 3] = 255;
      }
      return { data };
    } }) };
  const N = (x, y) => ({ x: x / W, y: y / H });
  const tapped = [N(100, 300), N(400, 100), N(100, 100), N(400, 300)];   // 亂序
  const o = orientQuad(fakeCanvas, tapped);
  console.log(`  鏡像＋亂序點角：自動找到的擺法 ΔE ${o.de.toFixed(1)}（校正前 ${o.raw.toFixed(1)}），深膚色角在 (${o.quad[0].x.toFixed(2)}, ${o.quad[0].y.toFixed(2)})`);
  ok(o.de < 3 && Math.abs(o.quad[0].x - 400 / W) < 1e-9 && Math.abs(o.quad[0].y - 100 / H) < 1e-9,
     '四個角亂序點、畫面又是鏡像 → 自動試 8 種擺法，找到深膚色那一角，校正後 ΔE < 3');
  const wrong = [N(100, 100), N(400, 100), N(400, 300), N(100, 300)];     // 照螢幕左上開始＝鏡像下是錯的
  const fw = fitFromCanvas(fakeCanvas, wrong), fr = fitFromCanvas(fakeCanvas, o.quad);
  ok(fr && fr.de < 3 && (!fw || fw.de > fr.de * 3), '擺法錯（照螢幕左上當第一塊）色差明顯較大或直接不採用；正確擺法可用');
}

console.log('\n\x1b[1m28. 顏色校正的引導：需要的時候才提\x1b[0m');
{
  const chart = { de: 0.4, used: 24 };
  const good = { reliable: true, cct: 5600, samples: 120 };
  ok(colorStatus({ chart, chartSet: true }).level === 'ok' && colorLines(colorStatus({ chart, chartSet: true })).length === 0,
     '讀到色卡 → 量得準，不打擾');
  ok(colorStatus({ illum: good }).reason === 'sclera' && optsForColor(colorStatus({ illum: good })).length === 0,
     '沒有色卡、眼白正常、一般白光 → 不提校正');
  const lost = colorStatus({ chartSet: true, illum: good });
  ok(lost.level === 'needed' && lost.reason === 'chartLost', '設定過色卡卻讀不到 → 需要處理（就算眼白讀得到，也要讓人知道色卡出問題）');
  const none = colorStatus({ illum: null }), bad = colorStatus({ illum: { reliable: false } });
  ok(none.reason === 'noRef' && bad.reason === 'noRef' && none.level === 'needed', '眼白沒讀到或不可信 → 需要校正');
  const warm = colorStatus({ illum: { reliable: true, cct: 2900.4 } }), cool = colorStatus({ illum: { reliable: true, cct: 8200 } });
  ok(warm.level === 'suggest' && warm.reason === 'warm' && warm.cct === 2900 && cool.reason === 'cool',
     '明顯暖光（< 4000K）／冷光（> 7500K）→ 建議用色卡，但不是「需要」');
  ok(colorLines(warm)[0].key === 'adv.color.castWarm' && colorLines(warm)[0].params.cct === 2900, '　講出估到的色溫');
  ok(colorLines(none)[0].kind === 'caution' && colorLines(lost)[0].key === 'adv.color.chartLost', '可能量偏時用「提醒」的語氣');
  const opts = [...optsForColor(none), ...colorGuideOpts()];
  ok(opts.every((o) => ACTS.includes(o.act) && optEmoji(o)), '引導的選項都是已知動作、都有符號');
  ok(EXPLAIN_ACTS.includes('colorHow') && ANSWER_ACTS.includes('colorOpen') && ANSWER_ACTS.includes('colorLater'),
     '「怎麼讓顏色更準」問過就收掉；「打開設定」「先這樣」答過就收掉');
  ok(colorGuide(none).some((l) => l.key === 'adv.color.howLight') && colorGuide(none).some((l) => l.key === 'adv.color.howChart'),
     '沒有參考白色：給兩條路 —— 換光線重拍（誰都做得到）、設定色卡');
  ok(colorGuide(lost).every((l) => l.key !== 'adv.color.howLight'), '色卡讀不到：講色卡的事，不叫人換光線');
  const keys = [...colorLines(none), ...colorLines(lost), ...colorLines(warm), ...colorLines(cool),
                ...colorGuide(none), ...colorGuide(lost), ...colorGuide(warm)].map((l) => l.key);
  const allLines = keys.map((key) => ({ key, kind: 'fact' }));
  ok(allLines.every((l) => lineEmoji(l) === '🎨'), '引導的句子都有符號');
}

console.log(fail === 0 ? '\n\x1b[32m全部通過\x1b[0m\n' : `\n\x1b[31m${fail} 項失敗\x1b[0m\n`);
process.exit(fail ? 1 : 0);
