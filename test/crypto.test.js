// 암호화 왕복 검증:
//   fetch-sheets.mjs 가 암호화한 것을 site/index.html 의 복호화 코드로 실제로 푼다.
//
// 두 파일에서 함수를 직접 떼어 오므로, 한쪽만 고쳐서 짝이 안 맞으면 여기서 잡힌다.
//   실행:  node test/crypto.test.js
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const check = (name, cond, extra) => {
  if (!cond) fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : '\n       ' + extra));
};

// ── 빌드 쪽: encryptPayload() 를 떼어 온다 ──
const modSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-sheets.mjs'), 'utf8');
const encSrc = modSrc.match(/export function encryptPayload\([\s\S]*?\n}/)[0].replace('export ', '');
const encryptPayload = new Function('crypto', 'KDF_ITERATIONS',
  encSrc + '\nreturn encryptPayload;')(nodeCrypto, 600000);

// ── 브라우저 쪽: site/index.html 의 복호화 코드를 떼어 온다 ──
const siteSrc = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const b64Src  = siteSrc.match(/function b64ToBytes\(b64\)[\s\S]*?\n}/)[0];
const decSrc  = siteSrc.match(/async function decryptPayload\(blob, password\)[\s\S]*?\n}/)[0];
// node 18+ 에는 브라우저와 같은 globalThis.crypto.subtle 이 있다
const decryptPayload = new Function('crypto', 'atob', 'TextEncoder', 'TextDecoder',
  b64Src + '\n' + decSrc + '\nreturn decryptPayload;')(
    globalThis.crypto, s => Buffer.from(s, 'base64').toString('binary'), TextEncoder, TextDecoder);

// 테스트에서는 반복 횟수를 낮춰 빠르게 돈다 (알고리즘은 동일)
const FAST = 1000;

const SAMPLE = {
  generatedAt: '2026-09-07T00:00:00.000Z',
  includeComments: true,
  errors: {},
  free: { years: [2026], rows: [{ year:2026, month:9, day:2, participant:'초등학생',
          scores:[5,4,5,5,5,5,5,5], comment1:'레이저 미로가 재밌었어요', comment2:'' }] },
  educ: { years: [], rows: [] },
  prog: { years: [], rows: [] },
  camp: { years: [2026], rows: [{ year:2026, month:9, day:5, campType:'초등학생 SW캠프',
          scores:[5,5,4,5,5], comment1:'', comment2:'' }] },
};

(async () => {
  console.log('\n[왕복] 빌드에서 암호화 → 브라우저 코드로 복호화');
  const blob = encryptPayload(SAMPLE, '3141', FAST);

  check('encrypted 플래그가 붙는다', blob.encrypted === true);
  check('AES-GCM + PBKDF2-SHA256', blob.cipher === 'AES-GCM' && blob.kdf === 'PBKDF2-SHA256');
  check('salt·iv 가 매번 새로 생성된다',
        encryptPayload(SAMPLE, '3141', FAST).salt !== blob.salt);

  const back = await decryptPayload(blob, '3141');
  check('복호화 결과가 원본과 완전히 같다',
        JSON.stringify(back) === JSON.stringify(SAMPLE));
  check('주관식 원문까지 그대로 돌아온다',
        back.free.rows[0].comment1 === '레이저 미로가 재밌었어요');

  console.log('\n[잠금] 비밀번호가 틀리면 열리지 않는다');
  for (const wrong of ['3142', '0000', '314', '31411', '']) {
    let opened = false;
    try { await decryptPayload(blob, wrong); opened = true; } catch { /* 정상 */ }
    check(`'${wrong}' 로는 안 열린다`, !opened);
  }

  console.log('\n[내용 노출] 암호문에 원문이 남지 않는다');
  const raw = JSON.stringify(blob);
  check('주관식 원문이 파일에 안 보인다', !raw.includes('레이저'));
  check('설문 종류명이 파일에 안 보인다', !raw.includes('초등학생 SW캠프'));
  check('점수 배열이 평문으로 안 보인다', !raw.includes('"scores"'));
  check('갱신 시각은 평문 (잠금 화면에 표시용)', blob.generatedAt === undefined);

  console.log('\n[변조] 암호문을 건드리면 열리지 않는다');
  {
    const t = { ...blob };
    const b = Buffer.from(t.ciphertext, 'base64');
    b[0] ^= 0xff;                       // 한 바이트만 뒤집는다
    t.ciphertext = b.toString('base64');
    let opened = false;
    try { await decryptPayload(t, '3141'); opened = true; } catch { /* 정상 */ }
    check('1바이트만 바뀌어도 인증 태그가 걸러낸다', !opened);
  }

  console.log('\n[설정] 빌드가 비밀번호 없이는 파일을 만들지 않는다');
  {
    check('DASHBOARD_PASSWORD 가 없으면 종료한다',
          modSrc.includes('DASHBOARD_PASSWORD') && modSrc.includes('평문으로 공개되는 사고를 막으려고'));
    check('실제 반복 횟수는 60만회', modSrc.includes('KDF_ITERATIONS = 600000'));
    check('site/index.html 에 비밀번호가 없다', !siteSrc.includes('3141'));
  }

  console.log(fail ? `\n❌ 실패 ${fail}건\n` : '\n✅ 암호화 전부 통과\n');
  process.exit(fail ? 1 : 0);
})();
