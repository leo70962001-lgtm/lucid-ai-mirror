/**
 * 功能圖示：一套線條圖示，取代原本當成圖示用的表情符號（右側按鈕、分頁、字幕上的慢速／暫停／語音、返回、設定…）。
 *
 * 設計由 Gemini 提出（KOTO／Tactile Atelier）：24×24、只有線條、線寬 1.6、圓頭圓角、顏色跟著文字（currentColor）。
 * 這一家的小記號是一小段「準星刻度」（有的圖示旁邊多一小段短線），只放在幾個主要的圖示上。
 * 對話裡的表情符號（js/emoji.js）是語氣的一部分，不在這裡。
 */
export const UI_ICONS = {
  ask: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4H6.5A2.5 2.5 0 0 1 4 12.5v-7z"/><line x1="18" y1="3" x2="18" y2="5"/>',
  paint: '<path d="M18.5 3.5a2 2 0 0 1 2 2c0 1-0.5 2-1.5 3L12 15.5 8.5 12l7-7c1-1 2-1.5 3-1.5z"/><path d="M8.5 12L4 16.5c-1 1-1 2.5 0 3.5s2.5 1 3.5 0L12 15.5"/><line x1="12" y1="3" x2="12" y2="5"/>',
  camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/><circle cx="12" cy="12.5" r="3"/><line x1="20" y1="6.5" x2="21.5" y2="6.5"/>',
  compare: '<circle cx="9.5" cy="12" r="5.5"/><circle cx="14.5" cy="12" r="5.5"/><line x1="12" y1="3" x2="12" y2="5"/>',
  tune: '<line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/><circle cx="8.5" cy="6.5" r="2"/><circle cx="15.5" cy="12" r="2"/><circle cx="10.5" cy="17.5" r="2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2.5-1 2.5-2.2 0-0.6-0.2-1.1-0.6-1.5-0.4-0.4-0.4-1 0-1.4 0.3-0.3 0.8-0.4 1.3-0.4h1.3a3.5 3.5 0 0 0 3.5-3.5c0-4.7-4.7-7-8-7z"/><circle cx="8" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>',
  chevronDown: '<polyline points="6.5 9.5 12 15 17.5 9.5"/>',
  chevronUp: '<polyline points="6.5 14.5 12 9 17.5 14.5"/>',
  back: '<polyline points="14.5 6.5 9 12 14.5 17.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"/>',
  slow: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><line x1="12" y1="12" x2="8" y2="14.5"/><circle cx="12" cy="12" r="1.5"/><line x1="12" y1="2.5" x2="12" y2="4"/>',
  pause: '<rect x="6.5" y="5.5" width="3.5" height="13" rx="1"/><rect x="14" y="5.5" width="3.5" height="13" rx="1"/>',
  play: '<path d="M7.5 5.5l11 6.5-11 6.5v-13z"/><line x1="20" y1="12" x2="21.5" y2="12"/>',
  soundOn: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3v-5z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>',
  soundOff: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3v-5z"/><line x1="15.5" y1="9.5" x2="20" y2="14.5"/><line x1="20" y1="9.5" x2="15.5" y2="14.5"/>',
  download: '<line x1="12" y1="4" x2="12" y2="15"/><polyline points="8 11 12 15 16 11"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  undo: '<polyline points="8.5 6.5 4.5 10.5 8.5 14.5"/><path d="M4.5 10.5h10a5 5 0 0 1 0 10h-2.5"/>',
  redo: '<polyline points="15.5 6.5 19.5 10.5 15.5 14.5"/><path d="M19.5 10.5h-10a5 5 0 0 0 0 10h2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/><line x1="5.5" y1="5.5" x2="7" y2="7"/><line x1="17" y1="17" x2="18.5" y2="18.5"/><line x1="18.5" y1="5.5" x2="17" y2="7"/><line x1="7" y1="17" x2="5.5" y2="18.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/>',
  hand: '<path d="M9.5 12V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12.5 9.5a1.5 1.5 0 0 1 3 0V11.5"/><path d="M15.5 10.5a1.5 1.5 0 0 1 3 0v4.5a5.5 5.5 0 0 1-5.5 5.5h-1.5a5.5 5.5 0 0 1-4.5-2.5l-2-3a1.5 1.5 0 0 1 2.5-1.5l1.5 2"/><line x1="12" y1="2.5" x2="12" y2="3.5"/>',
  check: '<polyline points="5 12.5 10 17.5 19.5 7"/>',
  close: '<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/>',
  mirror: '<ellipse cx="12" cy="11" rx="5.5" ry="7.5"/><line x1="12" y1="18.5" x2="12" y2="21.5"/><line x1="19" y1="3.5" x2="20.5" y2="3.5"/>',
};
/** 一個圖示的 <svg> 字串；沒有這個名字就回空的 svg（不會壞版） */
export const uiIcon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[name] || ''}</svg>`;
