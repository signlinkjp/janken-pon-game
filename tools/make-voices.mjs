/**
 * かけ声の音声ファイル（assets/voices/{code}.mp3）を作る（Build 5）
 *
 * アプリは音声合成を実行時に呼ばず、ここで作った mp3 を同梱して鳴らす。
 * 生成は Microsoft Edge の Neural Voice（edge-tts）。国ごとの声と読み上げる
 * テキストは src/countries.js の `speech` が持つ。
 *
 *   node tools/make-voices.mjs            # 無い（または壊れた）ファイルだけ作る
 *   node tools/make-voices.mjs --force    # 全部作り直す
 *   node tools/make-voices.mjs JP US      # 指定した国だけ
 *
 * 前提: `uvx --from edge-tts edge-tts`（初回は uvx がパッケージを取得する）
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COUNTRIES, voiceFile } from '../src/countries.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** かけ声をテンポ良く読む（edge-tts の rate。+ で速く） */
export const VOICE_RATE = '+25%';
/** これ未満は「空・壊れた mp3」とみなす（どのかけ声も数KB以上ある） */
export const MIN_VOICE_BYTES = 4000;

/** mp3 として先頭が読めるか（ID3 タグ、または MPEG のフレーム同期） */
export function looksLikeMp3(path) {
  try {
    const head = readFileSync(path).subarray(0, 3);
    return (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) // 'ID3'
      || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  } catch {
    return false;
  }
}

function isGood(path) {
  try {
    return statSync(path).size >= MIN_VOICE_BYTES && looksLikeMp3(path);
  } catch {
    return false;
  }
}

function generate(country, { force = false } = {}) {
  const speech = country.speech;
  if (!speech?.voice || !speech?.text) throw new Error(`${country.code}: speech.voice / speech.text がありません`);
  const out = resolve(ROOT, voiceFile(country.code));
  if (!force && isGood(out)) return { code: country.code, skipped: true, bytes: statSync(out).size };

  const result = spawnSync(
    'uvx',
    [
      '--from', 'edge-tts', 'edge-tts',
      '--voice', speech.voice,
      `--rate=${VOICE_RATE}`,
      '--text', speech.text,
      '--write-media', out,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`${country.code}: edge-tts が失敗しました\n${result.stderr || result.stdout || ''}`);
  }
  if (!isGood(out)) throw new Error(`${country.code}: ${voiceFile(country.code)} が空か壊れています`);
  return { code: country.code, skipped: false, bytes: statSync(out).size };
}

export function makeVoices({ force = false, codes = null } = {}) {
  mkdirSync(resolve(ROOT, 'assets/voices'), { recursive: true });
  const targets = COUNTRIES.filter((country) => !codes || codes.includes(country.code));
  return targets.map((country) => generate(country, { force }));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const codes = args.filter((arg) => !arg.startsWith('--'));
  const results = makeVoices({ force, codes: codes.length ? codes : null });
  for (const row of results) {
    console.log(`${row.code}: ${row.skipped ? 'そのまま' : '生成'} ${row.bytes} bytes`);
  }
  console.log(`${results.length} か国ぶんの音的準備ができました`);
}
