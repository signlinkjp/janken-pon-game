/**
 * JANKeN PoN — Build 8 の確定仕様テスト
 *
 * Build 8 で入れたものを、ここで固定する:
 *   1. 国をえらぶシートの各国カードに 🔊（かけ声の試聴）
 *      - 全19か国。押すと assets/voices/{code}.mp3 を鳴らす（国籍は変えない）
 *      - 無料のまま・国籍ロック後でも押せる（PRO も解禁しない）
 *      - 押した 🔊 だけが点灯（is-playing / aria-pressed）し、声が終わると消える
 *      - 同じ 🔊 をもう一度押すと停止。シートを閉じると止まる
 *   2. 起動直後のオープニング（約1.6秒）
 *      - 地球が回る＋✊✌️✋ が弾む＋JANKeN PoN World のロゴ＋一言
 *      - タップですぐ進む／1.6秒で自動／?fast=1 はホームへ直行
 *   3. ビルド番号 8（pbxproj 2箇所・アプリ側・設定の版表示・www/ 同期）
 *
 * 実ブラウザ（Chromium）での操作・見た目は tools/shots-b8.mjs が確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEYS, DICT, LOCALES } from '../src/i18n.js';
import { COUNTRIES, COUNTRY_COUNT, voiceFile } from '../src/countries.js';
import { VOICE_MIN_BYTES } from '../src/audio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));
const size = (path) => statSync(resolve(ROOT, path)).size;

const MAIN = read('src/main.js');
const HTML = read('index.html');
const CSS = read('styles.css');

/** 指定した関数（function name()）の中身だけを取り出す */
function bodyOf(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}() がある`);
  const next = MAIN.indexOf('\nfunction ', start + 10);
  return MAIN.slice(start, next < 0 ? MAIN.length : next);
}

/* ================================================================== *\
 * 1. 国カードの 🔊（かけ声の試聴）
 * ================================================================== */

test('国: 19か国すべての声（mp3）が入っていて、空・壊れたファイルではない', () => {
  assert.equal(COUNTRIES.length, 19);
  assert.equal(COUNTRY_COUNT, 19);
  for (const country of COUNTRIES) {
    const path = voiceFile(country.code);
    assert.ok(exists(path), `${country.code}: ${path}`);
    assert.ok(size(path) >= VOICE_MIN_BYTES, `${country.code}: ${size(path)} bytes`);
  }
});

test('国: どのカードにも 🔊（preview）ボタンが付く（全19か国・国コード付き）', () => {
  const grid = bodyOf('renderCountryGrid');
  assert.ok(grid.includes('for (const country of COUNTRIES)'), '19か国を回す');
  assert.ok(grid.includes("preview.className = 'country-item__preview'"), 'preview ボタン');
  assert.ok(grid.includes('preview.dataset.preview = country.code'), '国コードを持たせる');
  assert.ok(grid.includes("preview.innerHTML = '<img src=\"assets/icons/1f50a.svg\" alt=\"\" />'"), '🔊 のアイコン');
  assert.ok(grid.includes('item.append(pick, preview)'), 'カード本体と 🔊 を並べる');
  assert.ok(exists('assets/icons/1f50a.svg'));
});

test('国: 🔊 は stopPropagation で「国を選ぶ」に伝わらない', () => {
  const grid = bodyOf('renderCountryGrid');
  const previewHandler = grid.slice(grid.indexOf('preview.addEventListener'));
  assert.ok(previewHandler.includes('event.stopPropagation()'), '親（pick）へ伝えない');
  assert.ok(previewHandler.includes('previewCountryVoice(country, preview)'), 'その国の声を鳴らす');
  /* pick 側には stopPropagation を足さない（既存の選択の流れを変えない） */
  const pickHandler = grid.slice(grid.indexOf('pick.addEventListener'), grid.indexOf('preview.addEventListener'));
  assert.equal(pickHandler.includes('stopPropagation'), false);
});

test('国: 試聴は国籍を変えず、PRO も解禁しない（無料のまま全19か国）', () => {
  const body = bodyOf('previewCountryVoice');
  for (const forbidden of ['persist(', 'countryCode:', 'setPro(', 'pro: true', 'countryLocked']) {
    assert.equal(body.includes(forbidden), false, `試聴で ${forbidden} をしない`);
  }
  /* 音のエンジンの voice は小文字（audio.voice）なので、試聴の状態も小文字で持つ */
  assert.ok(body.includes('const key = String(country.code).toLowerCase()'), '小文字の国コード');
  assert.ok(body.includes('markCountryPreview(button, key)'), '点灯も小文字');
  assert.ok(body.includes('sound.playVoice(key)'), 'その国のかけ声を鳴らす');
  assert.ok(body.includes('sound.unlock()'), 'タップの中で音を起こす（iOS）');
  /* 国籍のロック判定は「国を選ぶ」側だけ。🔊 には canChangeCountry の門番を置かない */
  const grid = bodyOf('renderCountryGrid');
  const previewHandler = grid.slice(grid.indexOf('preview.addEventListener'));
  assert.equal(previewHandler.includes('canChangeCountry'), false, 'ロック後も押せる');
});

test('国: 無料のまま（pro なし）でも試聴の道が塞がれていない', () => {
  const body = bodyOf('previewCountryVoice');
  assert.equal(/isPro\(\)|app\.profile\.pro/.test(body), false, 'PRO 判定を持ち込まない');
  /* ロック中もカードを出す（is-disabled は本体だけを薄くする） */
  assert.match(CSS, /\.country-item\.is-disabled > \.country-item__pick\s*\{[^}]*opacity:\s*0\.45/);
  assert.equal(/\.country-item\.is-disabled\s*\{[^}]*opacity:\s*0\.45/.test(CSS), false, 'カード全体（🔊 を含む）は薄くしない');
});

test('国: 押した 🔊 だけが点灯し、声が終わると消える', () => {
  const mark = bodyOf('markCountryPreview');
  assert.ok(mark.includes("button.classList.add('is-playing')"));
  assert.ok(mark.includes("button.setAttribute('aria-pressed', 'true')"));
  assert.ok(mark.includes('clearCountryPreviewHighlight()'), '前の点灯を消す');
  assert.ok(mark.includes('sound.voice === code'), '鳴っている国を見る');
  assert.ok(mark.includes('stopCountryPreview({ audio: false })'), '終わったら消灯');
  const clear = bodyOf('clearCountryPreviewHighlight');
  assert.ok(clear.includes("classList.remove('is-playing')"));
  assert.ok(clear.includes("setAttribute('aria-pressed', 'false')"));
  assert.match(CSS, /\.country-item__preview\.is-playing\s*\{[^}]*background:\s*linear-gradient/);
  /* 特大文字では2列にして、国名と 🔊 が重ならない */
  assert.match(CSS, /html\[data-text-size="xlarge"\] \.country-grid\s*\{[^}]*repeat\(2, 1fr\)/);
  assert.match(CSS, /\.country-item__name\s*\{[^}]*padding-right:\s*22px/);
  assert.match(CSS, /\.country-item__preview\.is-playing img\s*\{[^}]*invert\(1\)/);
});

test('声: <audio> に落ちたときも、終わったら「鳴っている国」を戻す', () => {
  const audio = read('src/audio.js');
  assert.ok(audio.includes('element.onended = () =>'), '<audio> の終わりを拾う');
  assert.ok(/voicePlaying\.element === element\) voicePlaying = null/.test(audio), '同じ要素のときだけ戻す');
});

test('国: 同じ 🔊 をもう一度押すと止まり、シートを閉じても止まる', () => {
  const grid = bodyOf('renderCountryGrid');
  assert.ok(grid.includes('const again = countryPreview.code === String(country.code).toLowerCase()'), '同じ国を検出（小文字で）');
  assert.ok(grid.includes('if (again) return'), '2回目は停止だけ');
  const close = bodyOf('closeSheet');
  assert.ok(close.includes('stopCountryPreview()'), '閉じたら止める');
  const pick = bodyOf('renderCountryGrid');
  const pickHandler = pick.slice(pick.indexOf('pick.addEventListener'));
  assert.ok(pickHandler.includes('stopCountryPreview()'), '国を選んだら止める');
});

test('国: シートに「🔊 で試聴できる」案内がある（12言語）', () => {
  assert.ok(HTML.includes('id="country-preview-hint"'));
  assert.ok(HTML.includes('data-i18n="country.previewHint"'));
  assert.ok(KEYS.includes('country.previewHint'));
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['country.previewHint']?.includes('🔊'), `${locale.id}: 案内`);
  }
});

test('国: 読み上げ（aria-label）は「その国のかけ声を聞く」を12言語で', () => {
  assert.ok(MAIN.includes("preview.setAttribute('aria-label', T('country.preview', { country: countryName(country) }))"));
  assert.ok(KEYS.includes('country.preview'));
  for (const locale of LOCALES) {
    const value = DICT[locale.id]['country.preview'];
    assert.equal(typeof value, 'string', `${locale.id}: country.preview`);
    assert.ok(value.includes('{country}'), `${locale.id}: 国名を差し込む`);
  }
});

test('国: サウンド OFF のときは鳴らさず、OFF だと伝える（12言語）', () => {
  const body = bodyOf('previewCountryVoice');
  assert.ok(body.includes('if (!app.profile.sound)'), 'ミュート中は鳴らさない');
  assert.ok(body.includes("toast(T('country.muted')"), '理由を伝える');
  assert.ok(KEYS.includes('country.muted'));
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['country.muted'], `${locale.id}: country.muted`);
  }
});

/* ================================================================== *\
 * 2. オープニング（起動直後の約1.6秒）
 * ================================================================== */

test('オープニング: 画面に地球・✊✌️✋・ロゴ・一言・TAP TO START がある', () => {
  const start = HTML.indexOf('<div class="opening" id="opening"');
  assert.ok(start >= 0, '#opening がある');
  const end = HTML.indexOf('<!-- ============================= HOME', start);
  const splash = HTML.slice(start, end);
  assert.ok(splash.includes('assets/icons/1f30f.svg'), '回る地球');
  for (const hand of ['270a', '270c', '270b']) {
    assert.ok(splash.includes(`assets/icons/${hand}.svg`), `${hand} の手`);
  }
  assert.ok(splash.includes('JANKeN PoN'), 'ロゴ（JANKeN PoN）');
  assert.ok(splash.includes('>WORLD<'), 'ロゴ（WORLD）');
  assert.ok(splash.includes('opening__tagline') && splash.includes('data-i18n="opening.tagline"'), '一言');
  assert.ok(splash.includes('TAP TO START'), 'TAP TO START');
  assert.ok(splash.includes('id="btn-opening-start"'), 'タップのボタン（読み上げ用）');
  assert.ok(splash.includes('data-i18n-aria="opening.skip"'));
  for (const asset of ['assets/icons/1f30f.svg', 'assets/icons/270a.svg', 'assets/icons/270c.svg', 'assets/icons/270b.svg']) {
    assert.ok(exists(asset), asset);
  }
});

test('オープニング: 1.6秒で自動、タップですぐ、?fast=1 では出さない', () => {
  assert.match(MAIN, /const OPENING_MS = 1600;/);
  assert.match(MAIN, /const SKIP_OPENING = params\.has\('fast'\)/);
  /* スクショ用に自動で進めない ?opening=hold（タップすれば進む） */
  assert.match(MAIN, /const HOLD_OPENING = params\.get\('opening'\) === 'hold'/);
  assert.ok(bodyOf('startOpening').includes('if (HOLD_OPENING) return true'));
  const start = bodyOf('startOpening');
  assert.ok(start.includes("el.hidden = false"), '起動時に出す');
  assert.ok(start.includes('if (SKIP_OPENING)'), '?fast=1 は直行');
  assert.ok(start.includes('setTimeout(() => finishOpening(\'auto\'), OPENING_MS)'), '自動で進む');
  const finish = bodyOf('finishOpening');
  assert.ok(finish.includes("reason === 'tap'"), 'タップはすぐ');
  assert.ok(finish.includes('el.hidden = true'), '閉じる');
  const bind = bodyOf('bindOpening');
  assert.ok(bind.includes("el.addEventListener('pointerdown', tap)"), 'どこをタップしても飛ばせる');
  assert.ok(bind.includes("event.key === 'Escape'"), 'キーボードでも飛ばせる');
  /* boot でホームを出したあとに開幕を出す（ホームは裏で準備済み） */
  const boot = bodyOf('boot');
  assert.ok(/showScreen\('home'\);\s*startOpening\(\);/.test(boot));
});

test('オープニング: JS の API から飛ばせる（自動テスト用）', () => {
  assert.ok(MAIN.includes("skipOpening: () => finishOpening('api')"));
  assert.ok(/get opening\(\) \{[\s\S]{0,220}visible: Boolean\(el && !el\.hidden\)/.test(MAIN));
});

test('オープニング: 見た目のアニメーション（地球・手・ロゴ・TAP）と小画面・低モーション対応', () => {
  for (const keyframe of ['openingOut', 'openSpin', 'handPop', 'logoIn', 'worldIn', 'fadeUp', 'tapPulse', 'tapBob', 'beamPulse']) {
    assert.ok(CSS.includes(`@keyframes ${keyframe}`), `@keyframes ${keyframe}`);
  }
  assert.match(CSS, /\.opening\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*z-index:\s*60/);
  assert.match(CSS, /\.opening__earth\s*\{[^}]*animation:\s*openSpin/);
  assert.match(CSS, /\.opening__logo-main\s*\{[^}]*background-clip:\s*text/);
  assert.match(CSS, /\.opening__logo-world\s*\{[^}]*letter-spacing:\s*0\.52em/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}opening__earth/);
  assert.match(CSS, /@media \(max-height: 700px\)[\s\S]{0,200}opening__orbit/);
});

test('オープニング: 一言は12言語（TAP TO START は共通の掛け声）', () => {
  assert.ok(KEYS.includes('opening.tagline'));
  assert.ok(KEYS.includes('opening.tap'));
  assert.ok(KEYS.includes('opening.skip'));
  assert.equal(DICT.ja['opening.tagline'], '世界中のかけ声で真剣勝負！');
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['opening.tagline'].length > 4, `${locale.id}: tagline`);
    assert.equal(DICT[locale.id]['opening.tap'], 'TAP TO START', `${locale.id}: TAP TO START`);
    assert.ok(DICT[locale.id]['opening.skip'].length > 2, `${locale.id}: skip の読み上げ`);
  }
});

test('オープニング: 既存のブラウザ確認は ?fast=1 で開幕を飛ばす', () => {
  for (const tool of ['shots.mjs', 'shots-b2.mjs', 'shots-b3.mjs', 'shots-b4.mjs', 'shots-b5.mjs', 'shots-b6.mjs', 'shots-b7.mjs']) {
    const path = `tools/${tool}`;
    assert.ok(exists(path), path);
    assert.ok(read(path).includes('index.html?fast=1'), `${tool} は fast=1`);
  }
});

/* ================================================================== *\
 * 3. ビルド番号 8 と www 同期
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 9', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [9, 9], '2箇所とも 9');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(MAIN), 'アプリ側の build も 9');
  assert.ok(HTML.includes('(Build 9)'), '設定の版表示も Build 9');
});

test('www: 配布用の写しにも Build 9・🔊・オープニングが入る', async () => {
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(read('www/index.html').includes('(Build 9)'));
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(read('www/src/main.js')));
  assert.ok(read('www/index.html').includes('country-item__preview') === false, 'DOM は JS が作る');
  assert.ok(read('www/src/main.js').includes('country-item__preview'), 'www の JS に 🔊');
  assert.ok(read('www/index.html').includes('id="opening"'), 'www の画面にオープニング');
  assert.ok(read('www/styles.css').includes('.opening__earth'), 'www の CSS に開幕');
  assert.ok(exists('www/assets/icons/1f50a.svg'), 'www に 🔊 のアイコン');
  assert.ok(exists('www/assets/icons/1f30f.svg'), 'www に地球');
});

test('テスト: package.json の npm test が build9 を最後に走らせる', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts.test;
  assert.ok(script.includes('--test-concurrency=1'), 'www/ を共有するので直列');
  const order = script.match(/test\/[a-z0-9]+\.test\.js/g);
  assert.deepEqual(order, [
    'test/core.test.js', 'test/online.test.js', 'test/build1.test.js',
    'test/build2.test.js', 'test/build3.test.js', 'test/build4.test.js',
    'test/build5.test.js', 'test/build6.test.js', 'test/build7.test.js',
    'test/build8.test.js', 'test/build9.test.js',
  ]);
  assert.ok(readdirSync(resolve(ROOT, 'test')).includes('build9.test.js'));
  assert.ok(pkg.description.includes('Build 9'), 'package.json の説明も Build 9');
});

test('確認スクリプト: 実ブラウザで 🔊 と開幕を見る tools/shots-b8.mjs がある', () => {
  assert.ok(exists('tools/shots-b8.mjs'));
  const shots = read('tools/shots-b8.mjs');
  assert.ok(shots.includes('country-item__preview'), '🔊 を押す');
  assert.ok(shots.includes('assets/voices'), '鳴った声（mp3 の取得）を見る');
  assert.ok(shots.includes('countryLocked') && shots.includes('countryCode'), '国籍が変わらないことを見る');
  assert.ok(shots.includes('janken-b8-country-voices.png'), '国シートのスクショ');
  assert.ok(shots.includes('janken-b8-opening.png'), '開幕のスクショ');
  assert.ok(shots.includes('opening'), '開幕を確認する');
  assert.ok(shots.includes('skipOpening'), '開幕を飛ばす API を使う');
});
