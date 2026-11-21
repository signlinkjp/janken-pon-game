/* JANKeN PoN — the PRO unlock (世界挑戦パス).

   ひとつの非消耗型アイテムを StoreKit 2 で検証する（ios/App/App/AppDelegate.swift の
   StoreKitPlugin）。サーバーとは話さない。購入の正解は Apple の回答だけで、
   端末には「最後に分かった答え」をキャッシュして、オフライン起動でも PRO を保つ。

   このファイルが置かれうる3つの状態:
     store       ネイティブのプラグインがある — 本物の価格・本物の購入
     unavailable プラグインの無いネイティブビルド — PRO は閉じたまま
     preview     Web プレビュー — 体験スイッチで PRO を開いて確認できる（課金なし）

   CODE DUEL / ICE WOLF と同じ品質で作る: 失敗は必ず短い理由（`[SK: …]`）を残し、
   PRO シートがその理由を小さく表示する。 */

export const PRODUCT_ID = 'jp.signlink.JankenPon.pro';
export const PLUGIN_NAME = 'StoreKit';
export const STORE_KEY = 'janken-pon.pro.v1';

/* 無料と PRO の線引き（ここが唯一の正。UI もテストもこの関数だけを見る） */
export const FREE_LEVELS = ['easy', 'normal', 'hard'];
export const PRO_LEVELS = ['easy', 'normal', 'hard', 'master'];

export function levelsFor(entitled) {
  return entitled === true ? PRO_LEVELS : FREE_LEVELS;
}

export function canUseLevel(entitled, levelId) {
  return levelsFor(entitled).includes(levelId);
}

/** 世界の通信対戦・世界ランキングは PRO */
export function canPlayWorld(entitled) {
  return entitled === true;
}

/** 国内の通信対戦・国内ランキングは無料 */
export function canPlayDomestic() {
  return true;
}

/** 最大4人パーティーバトルは PRO */
export function canPlayParty(entitled) {
  return entitled === true;
}

/** 対戦相手の詳しい手の率（✊✌️✋%）は PRO */
export function canSeeOpponentRates(entitled) {
  return entitled === true;
}

/** ゴールド称号フレームは PRO */
export function frameFor(entitled) {
  return entitled === true ? 'gold' : 'standard';
}

/** 買い切り価格の表示（StoreKit の displayPrice が来たらそちらが優先） */
export const FALLBACK_PRICES = {
  ja: '¥480',
  en: '$2.99',
  'zh-Hans': '¥18',
  'zh-Hant': 'NT$90',
  ko: '₩4,400',
  es: '2,99 €',
  fr: '2,99 €',
  de: '2,99 €',
  pt: '2,99 €',
  it: '2,99 €',
  hi: '₹249',
  id: 'Rp49.000',
};

export function fallbackPrice(locale) {
  return FALLBACK_PRICES[locale] || FALLBACK_PRICES.en;
}

const MAX_REASON = 92;
let lastDiagnostic = '';

export function diagnostic() {
  return lastDiagnostic;
}

function noteDiagnostic(text) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const reason = /^SK:/.test(value) ? value : `SK: ${value}`;
  lastDiagnostic = `[${reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason}]`;
  return lastDiagnostic;
}

function clearDiagnostic() {
  lastDiagnostic = '';
}

function capacitor() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor || null;
}

function store() {
  const cap = capacitor();
  const plugins = cap && cap.Plugins;
  const plugin = plugins && plugins[PLUGIN_NAME];
  if (!plugin || typeof plugin.purchase !== 'function') return null;
  return plugin;
}

function nativePlatform() {
  const cap = capacitor();
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return Boolean(cap.isNativePlatform());
  return typeof cap.platform === 'string' && cap.platform !== 'web';
}

export function mode() {
  if (store()) return 'store';
  if (nativePlatform()) {
    noteDiagnostic('SK: no plugin');
    return 'unavailable';
  }
  return 'preview';
}

/** Web プレビューでは体験スイッチで PRO を開ける（本番の購入導線とは別物） */
export function previewAllowed() {
  return mode() === 'preview';
}

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function cachedEntitlement() {
  const box = storage();
  if (!box) return false;
  try {
    const raw = box.getItem(STORE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    return Boolean(saved && saved.entitled === true && saved.productId === PRODUCT_ID);
  } catch {
    return false;
  }
}

export function remember(entitled) {
  const box = storage();
  if (!box) return;
  try {
    box.setItem(STORE_KEY, JSON.stringify({ entitled: Boolean(entitled), productId: PRODUCT_ID, savedAt: Date.now() }));
  } catch {
    /* private mode: PRO still works for this session */
  }
}

/** ストアの返事が来る前にアプリが仮定する値 */
export function initialEntitlement() {
  return cachedEntitlement();
}

export async function loadPrice() {
  const plugin = store();
  if (!plugin) return null;
  try {
    const answer = await plugin.getProducts({ ids: [PRODUCT_ID] });
    const product = answer && Array.isArray(answer.products) ? answer.products[0] : null;
    if (!product) {
      noteDiagnostic((answer && answer.diag) || 'SK: empty');
      return null;
    }
    clearDiagnostic();
    return {
      id: product.id,
      price: product.displayPrice || '',
      name: product.displayName || '',
      description: product.description || '',
    };
  } catch (error) {
    noteDiagnostic((error && (error.message || error.code)) || 'SK: getProducts failed');
    return null;
  }
}

/** Apple ID が持っているかを聞く。null = 答えなし（持っていた値を保つ） */
export async function refresh() {
  const plugin = store();
  if (!plugin) {
    if (nativePlatform()) noteDiagnostic('SK: no plugin');
    return null;
  }
  try {
    const answer = await plugin.entitlement({ id: PRODUCT_ID });
    const entitled = Boolean(answer && answer.entitled);
    remember(entitled);
    return entitled;
  } catch (error) {
    noteDiagnostic((error && (error.message || error.code)) || 'SK: entitlement failed');
    return null;
  }
}

export async function purchase() {
  const plugin = store();
  if (!plugin) {
    noteDiagnostic('SK: no plugin');
    return { status: mode() === 'preview' ? 'preview' : 'unavailable' };
  }
  try {
    const answer = await plugin.purchase({ id: PRODUCT_ID });
    if (answer && answer.entitled === true) {
      clearDiagnostic();
      remember(true);
      return { status: 'success', transactionId: answer.transactionId || null };
    }
    const status = (answer && answer.status) || 'failed';
    if (status === 'cancelled') {
      clearDiagnostic();
      return { status };
    }
    if (answer && answer.diag) noteDiagnostic(answer.diag);
    else if (status === 'failed') noteDiagnostic('SK: purchase not finished');
    return { status };
  } catch (error) {
    const message = (error && (error.message || error.code)) || 'SK: purchase failed';
    noteDiagnostic(message);
    return { status: 'failed', error: String(message) };
  }
}

export async function restore() {
  const plugin = store();
  if (!plugin) {
    noteDiagnostic('SK: no plugin');
    return { status: mode() === 'preview' ? 'preview' : 'unavailable' };
  }
  try {
    const answer = await plugin.restore({ id: PRODUCT_ID });
    const entitled = Boolean(answer && answer.entitled);
    remember(entitled);
    if (answer && answer.diag && !entitled) noteDiagnostic(answer.diag);
    return { status: entitled ? 'restored' : 'nothing' };
  } catch (error) {
    noteDiagnostic((error && (error.message || error.code)) || 'SK: restore failed');
    return { status: 'failed' };
  }
}
