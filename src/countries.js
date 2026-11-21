/**
 * 世界のじゃんけんかけ声データ。
 *
 * 対戦相手（CPU / 将来のオンライン相手）はこの中の1か国として表示され、
 * 画面には「旗 ＋ その国の掛け声」が出る。
 *
 * フィールド:
 *   code        ISO 3166-1 alpha-2
 *   nameJa/nameEn
 *   flag        assets/flags/ の SVG
 *   chantParts  かけ声の区切り（1拍ずつ光らせるため）
 *   chant       静止表示用の全文（chantParts.join('') と一致）
 *   chantKana   日本語話者向けの読み（ラテン文字・非ラテン文字の国に付ける）
 *   flavor      相手カードに出す一言
 *   tint        相手カードのアクセント色
 *   modes       標準以外に遊べる特殊ルール
 */

const asset = (file) => `assets/flags/${file}.svg`;

export const COUNTRIES = Object.freeze([
  {
    code: 'JP', nameJa: '日本', nameEn: 'Japan', flag: asset('1f1ef-1f1f5'),
    chantParts: ['じゃん', 'けん', 'ぽん！'],
    chantKana: 'ジャン・ケン・ポン',
    flavor: '世界でいちばん短い、かけ声。',
    tint: '#ff5c5c',
  },
  {
    code: 'US', nameJa: 'アメリカ', nameEn: 'United States', flag: asset('1f1fa-1f1f8'),
    chantParts: ['Rock', 'Paper', 'Scissors', 'Shoot!'],
    chantKana: 'ロック・ペーパー・シザーズ・シュート',
    flavor: '最後の「Shoot!」で手を出す。',
    tint: '#4f7dff',
  },
  {
    code: 'BR', nameJa: 'ブラジル', nameEn: 'Brazil', flag: asset('1f1e7-1f1f7'),
    chantParts: ['Jo', 'ken', 'pô!'],
    chantKana: 'ジョ・ケン・ポー',
    flavor: '陽気な3拍子。リズムに乗せて。',
    tint: '#2fbf71',
  },
  {
    code: 'PE', nameJa: 'ペルー', nameEn: 'Peru', flag: asset('1f1f5-1f1ea'),
    chantParts: ['Yan', 'Ken', 'Po!'],
    chantKana: 'ヤン・ケン・ポ',
    flavor: '日系移民が持ち込んだ、南米のじゃんけん。',
    tint: '#e04b4b',
  },
  {
    code: 'FR', nameJa: 'フランス', nameEn: 'France', flag: asset('1f1eb-1f1f7'),
    chantParts: ['Pierre', 'Feuille', 'Ciseaux!'],
    chantKana: 'ピエール・フイユ・シゾー',
    flavor: '石・紙・はさみ。井戸（puits）を足す地方も。',
    tint: '#4a6cf7',
    modes: ['well'],
  },
  {
    code: 'KR', nameJa: '韓国', nameEn: 'South Korea', flag: asset('1f1f0-1f1f7'),
    chantParts: ['가위', '바위', '보!'],
    chantKana: 'カウィ・パウィ・ポ',
    flavor: 'あいこのあとは「ムクチパ」で決着をつける。',
    tint: '#f0619a',
  },
  {
    code: 'TH', nameJa: 'タイ', nameEn: 'Thailand', flag: asset('1f1f9-1f1ed'),
    chantParts: ['เป่า', 'ยิ้ง', 'ฉุบ!'],
    chantKana: 'パオ・イン・チュップ',
    flavor: '語尾が弾む、リズムのかけ声。',
    tint: '#8b5cf6',
  },
  {
    code: 'DE', nameJa: 'ドイツ', nameEn: 'Germany', flag: asset('1f1e9-1f1ea'),
    chantParts: ['Schnick', 'Schnack', 'Schnuck!'],
    chantKana: 'シュニック・シュナック・シュヌック',
    flavor: '子音が気持ちいい、早口のかけ声。',
    tint: '#f2b134',
  },
  {
    code: 'ID', nameJa: 'インドネシア', nameEn: 'Indonesia', flag: asset('1f1ee-1f1e9'),
    chantParts: ['Suit!'],
    chantKana: 'スイット',
    flavor: '「Suit!」の一語。ゾウ・人間・アリで遊ぶ地域も。',
    tint: '#e2453f',
    modes: ['epa'],
  },
  {
    code: 'CN', nameJa: '中国', nameEn: 'China', flag: asset('1f1e8-1f1f3'),
    chantParts: ['石头', '剪刀', '布!'],
    chantKana: 'シートウ・ジエンダオ・ブー',
    flavor: '石・はさみ・布。はっきり4拍。',
    tint: '#e63946',
  },
  {
    code: 'IT', nameJa: 'イタリア', nameEn: 'Italy', flag: asset('1f1ee-1f1f9'),
    chantParts: ['Sasso', 'Carta', 'Forbice!'],
    chantKana: 'サッソ・カルタ・フォルビチェ',
    flavor: '手ぶりが大きい、歌うようなじゃんけん。',
    tint: '#3fa34d',
  },
  {
    code: 'ES', nameJa: 'スペイン', nameEn: 'Spain', flag: asset('1f1ea-1f1f8'),
    chantParts: ['Piedra', 'Papel', 'Tijera!'],
    chantKana: 'ピエドラ・パペル・ティヘラ',
    flavor: '最後に「¡…ya!」と気合を足すことも。',
    tint: '#e8a33d',
  },
  {
    code: 'PH', nameJa: 'フィリピン', nameEn: 'Philippines', flag: asset('1f1f5-1f1ed'),
    chantParts: ['Bato', 'Bato', 'Pick!'],
    chantKana: 'バト・バト・ピック',
    flavor: '「バト・バト・ピック！」と2回石を歌う。',
    tint: '#2a9df4',
  },
  {
    code: 'RU', nameJa: 'ロシア', nameEn: 'Russia', flag: asset('1f1f7-1f1fa'),
    chantParts: ['Камень', 'Ножницы', 'Бумага!'],
    chantKana: 'カーメニ・ノージュニツィ・ブマーガ',
    flavor: 'あいこが続くと「Су-е-фа!」と畳みかける。',
    tint: '#5c7cfa',
  },
  {
    code: 'SE', nameJa: 'スウェーデン', nameEn: 'Sweden', flag: asset('1f1f8-1f1ea'),
    chantParts: ['Sten', 'Sax', 'Påse!'],
    chantKana: 'ステーン・サックス・ポーセ',
    flavor: '石・はさみ・袋。短く3拍。',
    tint: '#3d8bfd',
  },
  {
    code: 'TR', nameJa: 'トルコ', nameEn: 'Türkiye', flag: asset('1f1f9-1f1f7'),
    chantParts: ['Taş', 'Kâğıt', 'Makas!'],
    chantKana: 'タシュ・カウト・マカス',
    flavor: '石・紙・はさみ。伸ばす音がアクセント。',
    tint: '#e03131',
  },
  {
    code: 'VN', nameJa: 'ベトナム', nameEn: 'Vietnam', flag: asset('1f1fb-1f1f3'),
    chantParts: ['Oẳn', 'tù', 'tì!'],
    chantKana: 'オアン・トゥ・ティ',
    flavor: '「Oẳn tù tì」は「運だめし」の意味。',
    tint: '#f59f00',
  },
  {
    code: 'NL', nameJa: 'オランダ', nameEn: 'Netherlands', flag: asset('1f1f3-1f1f1'),
    chantParts: ['Steen', 'Papier', 'Schaar!'],
    chantKana: 'ステーン・パピール・スハール',
    flavor: '石・紙・はさみ。最後を伸ばして。',
    tint: '#f76707',
  },
  {
    code: 'PL', nameJa: 'ポーランド', nameEn: 'Poland', flag: asset('1f1f5-1f1f1'),
    chantParts: ['Kamień', 'Papier', 'Nożyce!'],
    chantKana: 'カミェン・パピェル・ノジツェ',
    flavor: '「カミェン・パピェル・ノジツェ」。',
    tint: '#d6336c',
  },
]);

export const DEFAULT_COUNTRY = 'JP';

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

export function countryByCode(code, fallback = DEFAULT_COUNTRY) {
  return BY_CODE.get(code) ?? BY_CODE.get(fallback) ?? COUNTRIES[0];
}

export function hasCountry(code) {
  return BY_CODE.has(code);
}

export function chantText(country) {
  return country.chantParts.join('');
}

/** 画面表示用（拍の区切りが分かるように中黒でつなぐ） */
export function chantLabel(country) {
  return country.chantParts.join('・');
}

export function modesForCountry(country) {
  return ['standard', ...(country.modes ?? [])];
}

/** ルールセットの本場の国（例: epa → インドネシア） */
export function countryForRuleset(rulesetId) {
  const code = { epa: 'ID', well: 'FR' }[rulesetId];
  return code ? countryByCode(code) : null;
}

/**
 * 対戦相手の国を選ぶ。excluded を渡すとその国は避ける。
 */
export function pickOpponent({ rng = Math.random, exclude = null, rulesetId = null } = {}) {
  let pool = COUNTRIES;
  if (exclude) pool = pool.filter((country) => country.code !== exclude);
  if (!pool.length) pool = COUNTRIES;

  // 特殊ルールのときは本場の国が出やすい（毎回ではない）
  const home = rulesetId ? countryForRuleset(rulesetId) : null;
  if (home && pool.some((country) => country.code === home.code) && rng() < 0.6) {
    return home;
  }
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[index];
}

export const COUNTRY_COUNT = COUNTRIES.length;
