/**
 * 臉型分析
 *
 * ── 這一層在做什麼 ──
 * 從臉部關鍵點量四個尺寸（臉長、額頭寬、顴骨寬、下顎寬）加上下巴收窄的程度與下顎轉角，
 * 對照美妝常用的臉型比例表，給出「比較接近哪一種臉型」，再從臉型推到腮紅畫法與適合的妝容。
 *
 * ── 三個必須先講清楚的限制 ──
 * 1. 臉型分類本身就不精確。比例表來自 1930 年代好萊塢化妝師（Westmore 兄弟），
 *    原始前提是「鵝蛋臉最理想，其他臉型用妝修成鵝蛋臉」。這台機器**不採用那個前提**：
 *    臉型只用來挑「怎麼畫會把這個臉型本來的樣子襯出來」，不講修飾、不講顯瘦。
 * 2. 門檻沒有用標註過臉型的真人照片校準過。長寬比的範圍直接取自公開的比例表；
 *    其他四個特徵的典型值是依表上的文字描述訂的，只用一張看得到髮際線的測試臉對過。
 *    所以輸出一律講「比較接近」，兩種臉型分數接近時就講「介於兩者之間」。
 * 3. 明星例子在不同媒體常互相矛盾 —— 一份 2019 年的研究整理已發表的資料，
 *    117 位女星裡有 62 位被不同來源分到不同臉型。這裡只收在多份清單裡被分到同一類的人，
 *    而且只當「這種臉型的例子」，**不說使用者像誰**。
 *
 * 比例表：goldenratioface.net/face-shape-chart（整理自 Westmore 與 Glamour-Graph）
 * 量法：Birchbox、1-800 Contacts、Kraywoods 的臉型量測指南
 * 腮紅畫法：Charlotte Tilbury、L'Oréal Paris、NYX、Laura Mercier、植村秀台灣、造咖
 */

export const FACE_SHAPES = ['oval', 'round', 'square', 'heart', 'oblong', 'diamond'];

// MediaPipe 臉部網格上成對的輪廓點（左右對稱）
const FACE_IDX = {
  top: 10, chin: 152, nose: 2, browL: 105, browR: 334, forehead: 151,
  temple: [21, 251],     // 額頭寬（眉毛高度的太陽穴）
  cheek:  [234, 454],    // 顴骨寬（臉最寬處）
  jaw:    [172, 397],    // 下顎寬（下顎角）
  chinW:  [149, 378],    // 下巴兩側 —— 跟下顎寬比，看下巴收得多尖
};

const px = (lm, i, W, H) => ({ x: lm[i].x * W, y: lm[i].y * H });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 在照片上找髮際線：沿著臉的中線，從額頭往上走，找「膚色變成頭髮」的地方。
 *
 * MediaPipe 最上方的點在額頭中段，不是髮際線 —— 直接拿它當臉的頂端，臉會被量短；
 * 用五官比例（三庭）推算又不準（測試臉用三庭推出 1.72 倍，實際找到髮際線量是 1.58 倍）。
 * 所以先用像素找；瀏海、淺色髮、帽子讓它找不到時，才退回估算，並且照實標出來。
 */
export function findHairline(canvas, lm) {
  if (!canvas || !lm) return null;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const top = px(lm, FACE_IDX.top, W, H), chin = px(lm, FACE_IDX.chin, W, H);
  const brow = { x: (lm[FACE_IDX.browL].x + lm[FACE_IDX.browR].x) / 2 * W, y: (lm[FACE_IDX.browL].y + lm[FACE_IDX.browR].y) / 2 * H };
  const len = dist(top, chin) || 1;
  const u = { x: (top.x - chin.x) / len, y: (top.y - chin.y) / len };   // 往頭頂的方向
  const gap = dist(brow, top);                                          // 眉毛到網格頂端

  const lab = (x, y) => {
    const r = 3, sx = Math.max(0, Math.round(x - r)), sy = Math.max(0, Math.round(y - 1));
    const d = ctx.getImageData(sx, sy, Math.min(r * 2, W - sx), Math.min(3, H - sy)).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return n ? rgbLab(R / n, G / n, B / n) : null;
  };
  // 額頭的膚色基準：網格頂端往下一點（避開髮際的陰影）
  const f = px(lm, FACE_IDX.forehead, W, H);
  const ref = lab((f.x + top.x) / 2, (f.y + top.y) / 2);
  if (!ref) return null;

  // 沿一條線往上走，回傳「連續 3 步都不像額頭」的起點距離；找不到回 null
  const scan = (ox, oy) => {
    let run = 0;
    for (let s = 2, max = Math.round(gap * 3); s <= max; s++) {
      const x = top.x + ox + u.x * s, y = top.y + oy + u.y * s;
      if (y < 1 || x < 1 || x > W - 2) return null;
      const c = lab(x, y);
      const de = c ? Math.hypot(c.L - ref.L, c.a - ref.a, c.b - ref.b) : 0;
      run = de > 18 ? run + 1 : 0;
      if (run >= 3) {
        const at = s - 2;
        // 太貼近網格頂端（< 0.3 倍眉距）多半是瀏海陰影；太遠多半是背景 —— 都不採信
        return at < gap * 0.3 || at > gap * 3 ? null : at;
      }
    }
    return null;
  };

  // 走三條線：正中間，以及左右各偏臉寬的 12%。
  // 只走正中間的話，中分的髮型會沿著頭皮的分線一路往上走，把臉量得太長。
  const cheekW = dist(px(lm, FACE_IDX.cheek[0], W, H), px(lm, FACE_IDX.cheek[1], W, H));
  const v = { x: -u.y, y: u.x }, k = cheekW * 0.12;
  const cols = [scan(-v.x * k, -v.y * k), scan(0, 0), scan(v.x * k, v.y * k)];
  const hits = cols.filter((c) => c != null).sort((a, b) => a - b);
  // 三條都找到取中間那條；只有兩條取比較低的（分線、髮旋都只會讓某一條偏高）
  const at = hits.length >= 3 ? hits[1] : hits.length === 2 ? hits[0] : null;
  if (at != null) return { x: top.x + u.x * at, y: top.y + u.y * at, found: true, cols, gap, ratio: at / gap };

  // 找不到：用測試臉量到的比例估，並且照實標成「估的」
  const est = gap * HAIR_EST;
  return { x: top.x + u.x * est, y: top.y + u.y * est, found: false, cols };
}

// 髮際線找不到時的估計值：髮際在網格頂端上方「眉毛到網格頂端距離」的幾倍。
// 1.25 是測試臉上真的找到髮際線時量到的比例（1.246）—— 只有一個樣本，所以找不到時一定照實標成「估的」。
// （最早寫的 0.55 來自目測，照片上畫出量測線後才發現目測看錯了。）
export const HAIR_EST = 1.25;

/** 從關鍵點（與可選的髮際線）算出分類要用的五個特徵 */
export function faceFeatures(lm, W, H, hairline) {
  if (!lm || !lm[FACE_IDX.chin]) return null;
  const P = (i) => px(lm, i, W, H);
  const pair = ([a, b]) => dist(P(a), P(b));
  const chin = P(FACE_IDX.chin), top = P(FACE_IDX.top);
  const brow = { x: (P(FACE_IDX.browL).x + P(FACE_IDX.browR).x) / 2, y: (P(FACE_IDX.browL).y + P(FACE_IDX.browR).y) / 2 };
  const head = hairline || { x: top.x + (top.x - brow.x) * HAIR_EST, y: top.y + (top.y - brow.y) * HAIR_EST };
  const length = dist(head, chin);
  const cheek = pair(FACE_IDX.cheek), temple = pair(FACE_IDX.temple), jaw = pair(FACE_IDX.jaw), chinW = pair(FACE_IDX.chinW);
  // 下顎轉角：下顎角 → 顴骨 與 下顎角 → 下巴 兩條線的夾角。越小代表轉得越利（方）
  const angleAt = (j, k) => {
    const J = P(j), K = P(k);
    const a = { x: K.x - J.x, y: K.y - J.y }, b = { x: chin.x - J.x, y: chin.y - J.y };
    const c = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  };
  return {
    R: length / cheek,            // 臉長 ÷ 臉寬
    fr: temple / cheek,           // 額頭寬 ÷ 臉寬
    jr: jaw / cheek,              // 下顎寬 ÷ 臉寬
    taper: chinW / jaw,           // 下巴寬 ÷ 下顎寬（越小越尖）
    jawDeg: (angleAt(FACE_IDX.jaw[0], FACE_IDX.cheek[0]) + angleAt(FACE_IDX.jaw[1], FACE_IDX.cheek[1])) / 2,
    estimated: !hairline || hairline.found === false,
    lines: { head, chin, temple: FACE_IDX.temple.map(P), cheek: FACE_IDX.cheek.map(P), jaw: FACE_IDX.jaw.map(P) },
  };
}

/**
 * 每種臉型的典型值。
 * R 的範圍取自公開比例表（鵝蛋 1.30–1.50、圓 1.00–1.25、方 1.00–1.28、長 1.50+、心形 1.25–1.55、菱形 1.35–1.55），
 * 取中間值當典型值；其他四項依表上的文字描述（最寬處在哪、下顎圓或有角、下巴尖不尖）訂，
 * 額頭／下顎／下巴／下顎角這四項的鵝蛋臉典型值，取自一張看得到髮際線的測試臉（它本身落在鵝蛋臉與長臉的交界）。
 */
export const PROTOTYPES = {
  oval:    { R: 1.40, fr: 0.96, jr: 0.76, taper: 0.56, jawDeg: 141 },
  round:   { R: 1.13, fr: 0.95, jr: 0.80, taper: 0.62, jawDeg: 145 },
  square:  { R: 1.15, fr: 0.98, jr: 0.90, taper: 0.64, jawDeg: 128 },
  oblong:  { R: 1.62, fr: 0.97, jr: 0.86, taper: 0.60, jawDeg: 138 },
  heart:   { R: 1.40, fr: 1.03, jr: 0.71, taper: 0.47, jawDeg: 146 },
  diamond: { R: 1.45, fr: 0.87, jr: 0.71, taper: 0.50, jawDeg: 144 },
};
const SPREAD = { R: 0.12, fr: 0.05, jr: 0.05, taper: 0.06, jawDeg: 6 };
const WEIGHT = { R: 1.0, fr: 0.7, jr: 0.8, taper: 0.6, jawDeg: 0.6 };

/**
 * 分類：每種臉型算一個相似度，換成比例。
 * 回傳第一名、第二名與兩者差距 —— 差距小就該講「介於兩者之間」，不硬選一個。
 */
export function classifyFace(f) {
  if (!f) return null;
  const raw = {};
  for (const s of FACE_SHAPES) {
    let d2 = 0;
    for (const k of Object.keys(SPREAD)) d2 += WEIGHT[k] * ((f[k] - PROTOTYPES[s][k]) / SPREAD[k]) ** 2;
    raw[s] = Math.exp(-0.5 * d2);
  }
  // 總和要先留著判斷「全都不像」—— 之前直接寫 || 1 補分母，全部下溢成 0 時總和變成 1，
  // 側臉之類量壞的照片就照樣得到一個看起來很有把握的臉型。
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const prob = Object.fromEntries(FACE_SHAPES.map((s) => [s, sum > 0 ? raw[s] / sum : 0]));
  const order = [...FACE_SHAPES].sort((a, b) => prob[b] - prob[a]);
  return {
    shape: order[0], second: order[1],
    conf: prob[order[0]], margin: prob[order[0]] - prob[order[1]],
    between: prob[order[0]] - prob[order[1]] < 0.15,     // 分不太開 → 講「介於兩者之間」
    prob, estimated: !!f.estimated,
    // 全部都很不像（相似度總和極低）→ 量測本身可能有問題（側臉、遮擋），不給結論
    unsure: sum < 1e-6,
  };
}

/**
 * 臉型 → 妝容的加分，以及為什麼。
 *
 * 加分依據是「這種臉型常見的畫法建議」跟「這款妝容本身的配置」有沒有對上：
 *   鵝蛋臉  比例均衡，打亮顴骨帶出立體感 → 韓系微光（珠光頰）、自然偽素顏
 *   圓臉    腮紅往太陽穴斜刷、霧面增加輪廓 → 清透通勤（霧面頰）、復古氣質（重心在唇）
 *   方臉    圓弧暈染柔和線條、柔光 → 韓系微光（珠光）、自然偽素顏（薄透）
 *   心形臉  下半臉用唇色平衡 → 韓系微光（漸層水光唇）、復古氣質（唇部重心）
 *   長臉    腮紅橫刷在蘋果肌 → 自然偽素顏（蘋果肌薄透）、韓系微光
 *   菱形臉  顏色放在蘋果肌、不堆在顴骨 → 清透通勤（均衡）、自然偽素顏
 * 加分乘上分類的把握度，所以「介於兩者之間」時兩邊都會加一點，不會全押在一邊。
 */
// 加分的量級刻意跟膚色分數的差距相當（膚色分數在四款之間大約差 10–30 分）。
// 最早只給 4–6 分，結果臉型講得再清楚，排序還是完全由膚色決定 —— 等於只是在說明，沒有在推薦。
export const FACE_LOOK_BONUS = {
  oval:    { kbeauty: 18, natural: 12 },
  round:   { clean: 18, retro: 12 },
  square:  { kbeauty: 18, natural: 12 },
  heart:   { kbeauty: 15, retro: 15 },
  oblong:  { natural: 18, kbeauty: 12 },
  diamond: { clean: 15, natural: 15 },
};

export function faceLookBonus(cls) {
  const out = {};
  if (!cls || cls.unsure) return out;
  for (const s of FACE_SHAPES) {
    for (const [look, b] of Object.entries(FACE_LOOK_BONUS[s])) out[look] = (out[look] || 0) + b * cls.prob[s];
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/**
 * 美妝媒體常拿來舉例的明星。
 * 交叉比對三份清單（faceshapedetector.app、myfaceshapetest.com、stylesatlife.com）與搜尋摘要，
 * 只收**至少兩份清單分到同一類**的人。被分到兩種臉型的（例如有人列方臉、有人列長臉）一律不收。
 * 只放名字、不放照片；商業場合如有肖像或代言上的顧慮，把 SHOW_CELEBS 關掉即可。
 */
export const SHOW_CELEBS = true;
export const CELEBS = {
  oval:    [{ name: '碧昂絲', name_en: 'Beyoncé', name_ja: 'ビヨンセ' },
            { name: '潔西卡·艾芭', name_en: 'Jessica Alba', name_ja: 'ジェシカ・アルバ' }],
  round:   [{ name: '席琳娜·戈梅茲', name_en: 'Selena Gomez', name_ja: 'セレーナ・ゴメス' },
            { name: '愛黛兒', name_en: 'Adele', name_ja: 'アデル' }],
  square:  [{ name: '安潔莉娜·裘莉', name_en: 'Angelina Jolie', name_ja: 'アンジェリーナ・ジョリー' },
            { name: '奧莉薇亞·魏爾德', name_en: 'Olivia Wilde', name_ja: 'オリヴィア・ワイルド' }],
  heart:   [{ name: '瑞絲·薇斯朋', name_en: 'Reese Witherspoon', name_ja: 'リース・ウィザースプーン' },
            { name: '史嘉蕾·喬韓森', name_en: 'Scarlett Johansson', name_ja: 'スカーレット・ヨハンソン' }],
  oblong:  [{ name: '莎拉·潔西卡·派克', name_en: 'Sarah Jessica Parker', name_ja: 'サラ・ジェシカ・パーカー' },
            { name: '麗芙·泰勒', name_en: 'Liv Tyler', name_ja: 'リヴ・タイラー' }],
  diamond: [{ name: '珍妮佛·羅培茲', name_en: 'Jennifer Lopez', name_ja: 'ジェニファー・ロペス' },
            { name: '荷莉·貝瑞', name_en: 'Halle Berry', name_ja: 'ハル・ベリー' }],
};

// ── 色彩換算（這個模組自己用，不依賴 analysis.js，避免循環匯入）──
function rgbLab(r, g, b) {
  const inv = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const R = inv(r / 255), G = inv(g / 255), B = inv(b / 255);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) };
}

/**
 * 這款妝容襯的是哪一種臉型（第一名優先，其次第二名）。
 * 「介於兩者之間」時，理由可能來自第二名 —— 講的時候要講出是哪一種，不能張冠李戴。
 */
export function faceReasonFor(cls, lookId) {
  if (!cls || cls.unsure) return null;
  for (const s of [cls.shape, cls.second]) {
    if (s && FACE_LOOK_BONUS[s][lookId]) return { shape: s, key: 'face.why.' + s + '.' + lookId };
  }
  return null;
}

/** 下巴的說法：數字換成一般人聽得懂的形容 */
export const chinWord = (taper) => (taper < 0.52 ? 'pointed' : taper > 0.6 ? 'wide' : 'soft');
