import { t } from './i18n.js';
/**
 * 商品目錄 — product-first 架構
 *
 * 重點：妝容(Look)本身不含任何顏色，只描述「角色 + 強度 + 偏好質地」。
 * 實際顏色一律來自商品的實測色值，由 resolveLook() 依膚色挑選。
 * 這樣 Step 4 渲染出來的顏色，保證等於 Step 3 推薦的那支商品。
 */

export const PRODUCTS = [
  // ── 唇部 ────────────────────────────────────────────────
  { id: 'L204', cat: 'lip', brand: 'AURA', name: '絲絨霧感唇膏', name_en: 'Velvet Matte Lipstick', name_ja: 'ベルベットマット リップ', shade: '#204 蜜楓棕', shade_en: '#204 Maple Brown', shade_ja: '#204 メープルブラウン',
    color: '#B4553F', finish: 'matte',   price: 890, tone: 'warm',
    tags: ['熱銷 No.1', '不易沾杯'], stock: 12 },
  { id: 'L118', cat: 'lip', brand: 'AURA', name: '絲絨霧感唇膏', name_en: 'Velvet Matte Lipstick', name_ja: 'ベルベットマット リップ', shade: '#118 玫瑰豆沙', shade_en: '#118 Rosewood', shade_ja: '#118 ローズウッド',
    color: '#C06B6B', finish: 'matte',   price: 890, tone: 'neutral',
    tags: ['百搭日常'], stock: 8 },
  { id: 'L307', cat: 'lip', brand: 'AURA', name: '絲絨霧感唇膏', name_en: 'Velvet Matte Lipstick', name_ja: 'ベルベットマット リップ', shade: '#307 冷調正紅', shade_en: '#307 Cool True Red', shade_ja: '#307 クールトゥルーレッド',
    color: '#C0293E', finish: 'matte',   price: 890, tone: 'cool',
    tags: ['顯白', '氣場款'], stock: 5 },
  { id: 'L512', cat: 'lip', brand: 'LUMI', name: '水光豐盈唇釉', name_en: 'Dewy Plump Lip Glaze', name_ja: 'デューイプランプ リップグレイズ',   shade: '#512 蜜桃汽水', shade_en: '#512 Peach Soda', shade_ja: '#512 ピーチソーダ',
    color: '#E0836F', finish: 'gloss',   price: 720, tone: 'warm',
    tags: ['夏季新色'], stock: 20 },
  { id: 'L620', cat: 'lip', brand: 'LUMI', name: '水光豐盈唇釉', name_en: 'Dewy Plump Lip Glaze', name_ja: 'デューイプランプ リップグレイズ',   shade: '#620 莓果紫紅', shade_en: '#620 Berry Plum', shade_ja: '#620 ベリープラム',
    color: '#A83A5C', finish: 'gloss',   price: 720, tone: 'cool',
    tags: ['秋冬限定'], stock: 0 },
  { id: 'L455', cat: 'lip', brand: 'LUMI', name: '水光豐盈唇釉', name_en: 'Dewy Plump Lip Glaze', name_ja: 'デューイプランプ リップグレイズ',   shade: '#455 裸感奶茶', shade_en: '#455 Nude Milk Tea', shade_ja: '#455 ヌードミルクティー',
    color: '#C1897A', finish: 'gloss',   price: 720, tone: 'neutral',
    tags: ['素顏友善'], stock: 15 },

  // ── 眼部 ────────────────────────────────────────────────
  { id: 'E01', cat: 'eye', brand: 'AURA', name: '四色眼影盤', name_en: 'Quad Eyeshadow Palette', name_ja: 'クワッド アイシャドウ パレット', shade: '01 大地暖棕', shade_en: '01 Warm Earth', shade_ja: '01 ウォームアース',
    color: '#A9714B', finish: 'shimmer', price: 1180, tone: 'warm',
    tags: ['新手友善'], stock: 9 },
  { id: 'E02', cat: 'eye', brand: 'AURA', name: '四色眼影盤', name_en: 'Quad Eyeshadow Palette', name_ja: 'クワッド アイシャドウ パレット', shade: '02 玫瑰灰粉', shade_en: '02 Rose Taupe', shade_ja: '02 ローズトープ',
    color: '#AE8087', finish: 'matte',   price: 1180, tone: 'cool',
    tags: ['溫柔感'], stock: 6 },
  { id: 'E03', cat: 'eye', brand: 'AURA', name: '四色眼影盤', name_en: 'Quad Eyeshadow Palette', name_ja: 'クワッド アイシャドウ パレット', shade: '03 香檳裸金', shade_en: '03 Champagne Gold', shade_ja: '03 シャンパンゴールド',
    color: '#C4A278', finish: 'shimmer', price: 1180, tone: 'neutral',
    tags: ['打亮兩用'], stock: 11 },

  // ── 頰彩 ────────────────────────────────────────────────
  { id: 'C01', cat: 'cheek', brand: 'LUMI', name: '空氣感腮紅', name_en: 'Airy Blush', name_ja: 'エアリー チーク', shade: '01 蜜桃橘', shade_en: '01 Peach Coral', shade_ja: '01 ピーチコーラル',
    color: '#E8896B', finish: 'matte',   price: 640, tone: 'warm',
    tags: ['好氣色'], stock: 14 },
  { id: 'C02', cat: 'cheek', brand: 'LUMI', name: '空氣感腮紅', name_en: 'Airy Blush', name_ja: 'エアリー チーク', shade: '02 冷調玫瑰', shade_en: '02 Cool Rose', shade_ja: '02 クールローズ',
    color: '#D97A8E', finish: 'matte',   price: 640, tone: 'cool',
    tags: ['偽素顏'], stock: 7 },
  { id: 'C03', cat: 'cheek', brand: 'LUMI', name: '空氣感腮紅', name_en: 'Airy Blush', name_ja: 'エアリー チーク', shade: '03 裸粉', shade_en: '03 Nude Pink', shade_ja: '03 ヌードピンク',
    color: '#DE9184', finish: 'shimmer', price: 640, tone: 'neutral',
    tags: ['自然過渡'], stock: 10 },
];

/** 妝容 = 角色配置，不含顏色 */
export const LOOKS = [
  {
    id: 'natural',
    audience: 'any',            // 偽素顏男女都適合
    name: '自然偽素顏',
    name_en: 'No-Makeup Look', name_ja: 'すっぴん風メイク',
    desc: '低彩度、薄透，看起來像天生氣色好。適合日常通勤與初次嘗試彩妝。',
    desc_en: 'Low chroma and sheer — reads as naturally good colouring. Right for everyday wear and a first try at makeup.',
    desc_ja: '低彩度で薄づき、生まれつき血色が良いように見えます。デイリー使いや初めてのメイクに。',
    intensity: { lip: 0.55, eye: 0.30, cheek: 0.38 },
    prefer:    { lip: 'gloss', eye: 'matte',   cheek: 'matte' },
  },
  {
    id: 'kbeauty',
    audience: 'women',
    name: '韓系微光妝',
    name_en: 'K-Beauty Glow', name_ja: '韓国風ツヤメイク',
    desc: '水光唇 + 珠光眼影，強調光澤與立體感，上鏡效果佳。',
    desc_en: 'Glossy lip plus shimmer eyeshadow — built around shine and dimension, and it photographs well.',
    desc_ja: 'ツヤリップとシマーアイシャドウで、光と立体感を強調。写真映えします。',
    intensity: { lip: 0.70, eye: 0.45, cheek: 0.45 },
    prefer:    { lip: 'gloss', eye: 'shimmer', cheek: 'shimmer' },
    lipGradient: true,          // 韓系漸層唇：內濃外淡
  },
  {
    id: 'retro',
    audience: 'women',
    name: '復古氣質妝',
    name_en: 'Retro Statement', name_ja: 'レトロ クラシック',
    desc: '霧面濃唇搭配收斂的眼妝，重心放在唇部，正式場合適用。',
    desc_en: 'A deep matte lip with restrained eyes — the weight sits on the mouth. Suits formal occasions.',
    desc_ja: 'マットな濃いリップに抑えたアイメイク。重心は口元、フォーマルな場に。',
    intensity: { lip: 0.92, eye: 0.35, cheek: 0.30 },
    prefer:    { lip: 'matte', eye: 'matte',   cheek: 'matte' },
  },
  {
    id: 'clean',
    audience: 'women',
    name: '清透通勤妝',
    name_en: 'Clean Office', name_ja: 'クリーン オフィス',
    desc: '均衡配置，三個部位強度接近，是最不容易出錯的組合。',
    desc_en: 'Balanced — all three areas at similar strength. The hardest combination to get wrong.',
    desc_ja: 'バランス型。3 部位の強さが近く、最も失敗しにくい組み合わせです。',
    intensity: { lip: 0.65, eye: 0.40, cheek: 0.42 },
    prefer:    { lip: 'matte', eye: 'shimmer', cheek: 'matte' },
  },
  {
    // 男士妝容：看不出上妝的清爽感。濃度壓得很低，三個部位一律先挑中性色 ——
    // 冷調膚色照一般規則會挑到冷調正紅與玫瑰灰粉，對「看不出上妝」來說太明顯。
    id: 'men',
    audience: 'men',
    neutralFirst: true,
    name: '清爽男士妝',
    name_en: "Men's Clean Grooming", name_ja: 'メンズ ナチュラル',
    desc: '看不出上妝的清爽感：氣色與眼周輕輕整理，唇只帶一點潤色。',
    desc_en: 'Clean and barely-there: a light touch on complexion and eyes, just a hint of colour on the lips.',
    desc_ja: 'メイク感のない清潔感。血色と目もとを軽く整え、唇はほんのり色づく程度に。',
    intensity: { lip: 0.22, eye: 0.12, cheek: 0.14 },
    prefer:    { lip: 'matte', eye: 'matte', cheek: 'matte' },
  },
];


export const catLabel = (c) => t('cat.' + c);
export const byId = (id) => PRODUCTS.find((p) => p.id === id);

/**
 * 依「膚色調性 + 妝容偏好質地」挑出實際商品。
 * 評分完全透明，會回傳 reason 供 UI 顯示 —— 不做黑箱推薦。
 */
export function resolveLook(look, undertone) {
  const picks = {};
  for (const cat of ['lip', 'eye', 'cheek']) {
    const scored = PRODUCTS
      .filter((p) => p.cat === cat)
      .map((p) => {
        let score = 0;
        const reason = [];
        // 理由存成 key + 參數，畫面層才決定要用哪種語言講
        if (p.tone === undertone)      { score += 50; reason.push(['reason.tone', { tone: undertone }]); }
        else if (p.tone === 'neutral') { score += 30; reason.push(['reason.neutral']); }
        else                           { score += 5; }
        if (p.finish === look.prefer[cat]) { score += 30; reason.push(['reason.finish', { finish: p.finish }]); }
        if (look.neutralFirst && p.tone === 'neutral') score += 60;     // 清爽系妝容：中性色優先於底調
        if (p.stock <= 0)  score -= 1000;
        if (p.stock <= 5)  { score -= 8; reason.push(['reason.lowStock']); }
        return { p, score, reason };
      })
      .sort((a, b) => b.score - a.score);

    picks[cat] = { ...scored[0].p, _reason: scored[0].reason, _alts: scored.slice(1, 4).map((s) => s.p) };
  }
  return picks;
}

export const toneLabel   = (x) => t('tone.' + x);
export const finishLabel = (f) => t('finish.' + f);
