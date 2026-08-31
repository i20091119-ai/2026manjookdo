// ============================================================
// 구글 시트 4개 → site/data.json
//
// GitHub Actions에서 돌린다. 로컬에서도 돌릴 수 있다:
//   GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" node scripts/fetch-sheets.mjs
//
// 외부 패키지를 쓰지 않는다 (node 18+ 내장 fetch/crypto만 사용).
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'site', 'data.json');

// ── 데이터 소스 ──────────────────────────────────────────
// 컬럼 번호는 0부터. A=0, B=1, C=2 ...
const SOURCES = {
  free: {
    label: '자유관람',
    ssId:  '1yZfJfJdEMJGZu9TMDXXDDk0edqURtIEUiwGlDRNRpag',
    sheet: '설문지 응답',
    range: 'A:P',
    // B=참여자(1), E~L=문항8개(4~11), O=주1(14), P=주2(15)
    map: (row, d) => ({
      year: d.year, month: d.month, day: d.day,
      participant: cell(row, 1),
      scores: toScores(row, 4, 8),
      comment1: cell(row, 14),
      comment2: cell(row, 15),
    }),
  },
  educ: {
    label: '교구대여',
    ssId:  '1_QHrQqTM4_J9rA4iw7dudEHqy2vhEzyXR7I9xrQW1Vs',
    sheet: '설문지 응답',
    range: 'A:I',
    // B=교구종류(1), C=학교급(2), D=설문자(3), E~H=문항4개(4~7), I=주관식(8)
    map: (row, d) => ({
      year: d.year, month: d.month, day: d.day,
      toolType:    cell(row, 1),
      schoolLevel: cell(row, 2),
      respondent:  cell(row, 3),
      scores: toScores(row, 4, 4),
      comment1: cell(row, 8),
    }),
  },
  prog: {
    label: '학교·가족 프로그램',
    ssId:  '1TzfWGDGqqbYxpsqgXXPT7dtWGYy7hbKBrkctFk-CO3g',
    sheet: '설문지 응답',
    range: 'A:O',
    // B=프로그램종류(1), C=설문자(2), D~H=프1~5(3~7), I~L=시1~4(8~11), M~O=주1~3(12~14)
    map: (row, d) => ({
      year: d.year, month: d.month, day: d.day,
      programType: cell(row, 1),
      respondent:  cell(row, 2),
      scores: toScores(row, 3, 9),
      comment1: cell(row, 12),
      comment2: cell(row, 13),
      comment3: cell(row, 14),
    }),
  },
  camp: {
    label: '여름방학 캠프',
    ssId:  '1csbLxMowWSNJ0LGFnrYa-Z6cC5ICJ_3FOe4UMhWqTts',
    sheet: '설문지 응답 시트1',   // 캠프만 탭 이름이 다르다
    range: 'A:I',
    // B=캠프종류(1), C~G=문항5개(2~6), H=주1(7), I=주2(8)
    map: (row, d) => ({
      year: d.year, month: d.month, day: d.day,
      campType: cell(row, 1),
      scores: toScores(row, 2, 5),
      comment1: cell(row, 7),
      comment2: cell(row, 8),
    }),
  },
};

// 주관식 원문을 data.json에 담을지.
// 응답 원문을 내보내고 싶지 않으면 false로 바꾼다.
// false로 두면 통계·월말 집계는 그대로 나오고 '주관식 응답' 절만 비게 된다.
const INCLUDE_COMMENTS = true;

// ── 암호화 설정 ──────────────────────────────────────────
// GitHub Pages는 공개라 data.json이 그대로 내려받힌다.
// 그래서 통계 내용을 통째로 암호화해서 올린다.
// 비밀번호 없이 받으면 의미 없는 바이트 덩어리만 얻는다.
//
// ⚠ 비밀번호가 짧으면 (예: 4자리) 파일을 받아서 전부 대입해 볼 수 있다.
//   PBKDF2 반복을 높여 한 번 시도에 시간이 걸리게 해 두었지만,
//   작정한 상대를 막으려면 비밀번호를 길게 쓰는 게 맞다.
const KDF_ITERATIONS = 600000;   // OWASP 권장치. 브라우저에서 0.5~2초 걸린다.

// ── 공통 변환 (Apps Script 판과 동일한 규칙) ─────────────

export function parseTs(ts) {
  if (ts instanceof Date) {
    return { year: ts.getFullYear(), month: ts.getMonth() + 1, day: ts.getDate() };
  }
  // '2026. 8. 5 오후 2:02' / '2026-08-05 14:02' / '2026/8/5' 모두 허용
  const m = String(ts).match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

/**
 * 만족도 응답 텍스트 → 1~5 점수. 인식 못 하면 null(통계에서 제외).
 *
 * 네 세대의 표현이 한 시트에 섞여 있어 전부 받아야 한다.
 *   구버전  : 매우 그렇다(매우그렇다) / 그렇다 / 보통이다 / 그렇지 않다 / 전혀 그렇지 않다
 *   신버전  : 매우 만족 / 만족 / 보통 / 불만족 / 매우 불만족
 *   복합형  : 매우 만족(매우 그렇다) ...
 *   선형배율: 5 / 4 / 3 / 2 / 1  (구글 폼 '선형 배율' 문항)
 *
 * ⚠ 새 표현이 생기면 조건을 "추가"만 하고 기존 조건은 지우지 말 것.
 * ⚠ '매우 불만족'을 '불만족'보다, '불만족'을 '만족'보다 먼저 검사해야 한다.
 */
export function scoreToNum(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return null;

  // 선형 배율(숫자) 문항
  if (/^[1-5](\.0+)?$/.test(s)) return parseInt(s, 10);

  // 앞에서부터 시작하는 표현 (복합형 '매우 만족(매우 그렇다)' 포함)
  if (s.indexOf('매우 불만족') === 0 || s.indexOf('매우불만족') === 0) return 1;
  if (s.indexOf('매우 만족') === 0 || s.indexOf('매우만족') === 0) return 5;
  if (s.indexOf('전혀 그렇지 않다') === 0) return 1;
  if (s.indexOf('매우 그렇다') === 0 || s.indexOf('매우그렇다') === 0) return 5;
  if (s.indexOf('불만족') === 0 || s.indexOf('그렇지 않다') === 0) return 2;
  if (s.indexOf('만족') === 0 || s.indexOf('그렇다') === 0) return 4;
  if (s.indexOf('보통') === 0) return 3;

  // 앞에 다른 말이 붙은 변형 대비 (순서 동일하게 유지)
  if (s.includes('매우 불만족') || s.includes('매우불만족')) return 1;
  if (s.includes('매우 만족') || s.includes('매우만족')) return 5;
  if (s.includes('전혀 그렇지 않다')) return 1;
  if (s.includes('매우 그렇다') || s.includes('매우그렇다')) return 5;
  if (s.includes('불만족') || s.includes('그렇지 않다')) return 2;
  if (s.includes('만족') || s.includes('그렇다')) return 4;
  if (s.includes('보통')) return 3;

  return null;
}

export function cell(row, idx) {
  return String(row[idx] == null ? '' : row[idx]).trim();
}

export function toScores(row, from, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(scoreToNum(row[from + i]));
  return out;
}

/** 시트 원본 2차원 배열 → {years, rows} */
export function transform(values, src, includeComments = true) {
  const rows = [];
  const yearSet = new Set();

  for (let i = 1; i < values.length; i++) {   // 0행은 머리글
    const row = values[i] || [];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet.add(d.year);
    const rec = src.map(row, d);
    if (!includeComments) {
      for (const k of Object.keys(rec)) if (k.startsWith('comment')) rec[k] = '';
    }
    rows.push(rec);
  }
  return { years: [...yearSet].sort((a, b) => a - b), rows };
}

// ── 암호화 ───────────────────────────────────────────────
// AES-256-GCM + PBKDF2(SHA-256). 브라우저 Web Crypto와 호환되는 조합이다.
// 암호문 뒤에 인증 태그를 붙여 두어야 crypto.subtle.decrypt 가 그대로 받는다.
export function encryptPayload(obj, password, iterations = KDF_ITERATIONS) {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')),
    cipher.final(),
  ]);

  return {
    encrypted: true,
    v: 1,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-GCM',
    iterations,
    salt: salt.toString('base64'),
    iv:   iv.toString('base64'),
    // 암호문 || 인증 태그(16바이트)
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
  };
}

// ── 구글 인증 (서비스 계정 JWT → 액세스 토큰) ────────────

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head  = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key);
  const jwt = `${head}.${claim}.${sig.toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`구글 토큰 발급 실패 (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 구글 API 호출 + 재시도.
 *
 * 시트 API가 이따금 '503 The service is currently unavailable' 같은
 * 일시적 오류를 던진다 — 우리 쪽 설정 문제가 아니라 구글 쪽 순간 장애다.
 * 이걸 그냥 실패로 두면 그 시간에 한해 해당 설문이 통째로 비어 버린다.
 *
 * ⚠ 5xx·429(과다 요청)만 재시도한다. 403(권한)·404(시트 없음)·400(잘못된 요청)은
 *   재시도해도 똑같이 실패하는 설정 문제라 즉시 던진다.
 */
async function api(token, url, attempt = 1) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    const transient = res.status >= 500 || res.status === 429;
    if (transient && attempt < 4) {
      const wait = 500 * 2 ** (attempt - 1); // 0.5s → 1s → 2s
      console.warn(`  ⚠ 구글 API 일시 오류(${res.status}), ${wait}ms 후 재시도 (${attempt}/3)`);
      await sleep(wait);
      return api(token, url, attempt + 1);
    }
    throw err;
  }
  return res.json();
}

/** 시트 탭 이름을 못 찾으면 첫 번째 탭으로 넘어간다 (Apps Script 판과 같은 동작) */
async function firstSheetTitle(token, ssId) {
  const meta = await api(token,
    `https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=sheets.properties.title`);
  return meta.sheets?.[0]?.properties?.title;
}

async function readValues(token, ssId, sheetName, range) {
  const get = name => api(token,
    `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/` +
    encodeURIComponent(`${name}!${range}`));
  try {
    return (await get(sheetName)).values || [];
  } catch (e) {
    if (e.status !== 400 && e.status !== 404) throw e;
    const fallback = await firstSheetTitle(token, ssId);
    if (!fallback) throw e;
    console.warn(`  ⚠ '${sheetName}' 탭을 못 찾아 '${fallback}' 탭을 대신 읽습니다`);
    return (await get(fallback)).values || [];
  }
}

// ── 실행 ─────────────────────────────────────────────────

async function main() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.');
    console.error('   docs/유지보수_가이드.md 의 「서비스 계정 만들기」를 먼저 하세요.');
    process.exit(1);
  }

  // 비밀번호가 없으면 아예 만들지 않는다.
  // 설정을 빠뜨렸다고 통계가 평문으로 공개되는 일은 없어야 한다.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error('❌ DASHBOARD_PASSWORD 환경변수가 없습니다.');
    console.error('   저장소 Settings → Secrets and variables → Actions 에');
    console.error('   DASHBOARD_PASSWORD 를 등록하세요.');
    console.error('   (평문으로 공개되는 사고를 막으려고 일부러 실패시킵니다)');
    process.exit(1);
  }

  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON 이 올바른 JSON이 아닙니다.');
    process.exit(1);
  }

  const token = await getAccessToken(sa);
  const out = { generatedAt: new Date().toISOString(), includeComments: INCLUDE_COMMENTS, errors: {} };
  let failed = 0;

  for (const [key, src] of Object.entries(SOURCES)) {
    try {
      const values = await readValues(token, src.ssId, src.sheet, src.range);
      out[key] = transform(values, src, INCLUDE_COMMENTS);
      console.log(`  ✅ ${src.label}: ${out[key].rows.length}행 · 연도 ${JSON.stringify(out[key].years)}`);
    } catch (e) {
      // 하나가 실패해도 나머지는 살린다
      out[key] = { years: [], rows: [] };
      out.errors[key] = String(e.message || e);
      failed++;
      console.error(`  ❌ ${src.label}: ${e.message || e}`);
    }
  }

  // 전부 실패했으면 멀쩡한 기존 data.json을 빈 파일로 덮어쓰지 않는다
  if (failed === Object.keys(SOURCES).length) {
    console.error('\n❌ 시트를 하나도 읽지 못했습니다. data.json을 건드리지 않고 종료합니다.');
    console.error('   서비스 계정 이메일에 4개 시트의 보기 권한을 줬는지 확인하세요.');
    process.exit(1);
  }

  // 갱신 시각만 평문으로 남긴다 — 잠금 화면에서 보여 주려고.
  // 통계 내용(free/educ/prog/camp)은 전부 암호문 안으로 들어간다.
  const generatedAt = out.generatedAt;
  const blob = encryptPayload(out, password);
  blob.generatedAt = generatedAt;

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(blob), 'utf8');

  const kb = (await fs.stat(OUT)).size / 1024;
  console.log(`\n✅ site/data.json 생성 (${kb.toFixed(1)} KB · 암호화됨)`);
  console.log(`   PBKDF2 ${KDF_ITERATIONS.toLocaleString()}회 + AES-256-GCM`);
  if (password.length < 8) {
    console.log(`   ⚠ 비밀번호가 ${password.length}자입니다. 짧은 비밀번호는 전부 대입해 뚫을 수 있습니다.`);
    console.log('     우연한 열람은 막지만, 작정한 상대까지 막으려면 8자 이상을 쓰세요.');
  }
  if (!INCLUDE_COMMENTS) console.log('   ※ INCLUDE_COMMENTS=false — 주관식 원문은 빠졌습니다');
}

// 테스트에서 import할 때는 실행하지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('❌', e); process.exit(1); });
}
