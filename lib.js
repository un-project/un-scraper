import fs from 'fs';

// GA sessions 1–30 used Roman numeral notation in resolution URLs (e.g. A/RES/103(I))
const GA_ROMAN_SESSION_CUTOFF = 30;

const URL_PATTERNS = {
  ga: { pv: 'A/{sessionId}/PV.{docId}', res: 'A/RES/{sessionId}/{docId}' },
  sc: { pv: 'S/PV.{docId}',            res: 'S/RES/{docId}({sessionId})' },
};

export function toRoman(n) {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}

export function buildUrl(body, type, sessionId, docId, lang) {
  // Legacy GA PV: globally-numbered plenary meetings before 1976 (A/PV.1–2444)
  // Signalled by sessionId=0; uses undocs.org and carries no language prefix.
  if (body === 'ga' && type === 'pv' && sessionId === 0)
    return `https://undocs.org/A/PV.${docId}`;

  // Legacy GA resolution: sessions I–XXX used Roman numeral notation (A/RES/103(I))
  if (body === 'ga' && type === 'res' && sessionId <= GA_ROMAN_SESSION_CUTOFF)
    return `https://docs.un.org/${lang}/A/RES/${docId}(${toRoman(sessionId)})`;

  const pattern = URL_PATTERNS[body][type]
    .replace('{sessionId}', sessionId)
    .replace('{docId}', docId);
  return `https://docs.un.org/${lang}/${pattern}`;
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
