// tools/jump-review/vocalize.js
//
// Number vocalization for TTS narration. TTS engines read "13,590 ft AGL"
// tolerably but not the way a jumper says it; these helpers produce the
// house style instead:
//
//   13,590 ft AGL -> "thirteen-thousand, five-hundred and ninety feet"
//   2,430 ft AGL  -> "two-thousand, four-hundred and thirty feet"
//
// Conventions: "-thousand"/"-hundred" hyphenated to their count, comma after
// the thousands group, "and" before the trailing tens/ones, and "AGL"
// dropped except in formal contexts (formal: true appends "above ground
// level"). Handles 0..999,999 — generous for anything a skydive produces.

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 1..99 -> "sixty-five", "thirty", "seven" */
function tensWords(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

/** 1..999 -> "five-hundred and ninety", "four-hundred", "sixty-five" */
function hundredsWords(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return tensWords(r);
  const head = `${ONES[h]}-hundred`;
  return r ? `${head} and ${tensWords(r)}` : head;
}

/** 0..999,999 -> house-style words. */
function numberWords(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return 'zero';
  const k = Math.floor(n / 1000);
  const r = n % 1000;
  if (k === 0) return hundredsWords(r);
  const thousands = `${hundredsWords(k)}-thousand`;
  if (r === 0) return thousands;
  // no hundreds in the remainder: "twelve-thousand and sixty-five"
  if (r < 100) return `${thousands} and ${tensWords(r)}`;
  return `${thousands}, ${hundredsWords(r)}`;
}

/** Altitude in feet -> spoken words, rounded to the nearest 10 ft.
 *  "AGL" is dropped unless formal: true. */
function vocalizeAltitudeFt(feet, { formal = false } = {}) {
  const rounded = Math.round(feet / 10) * 10;
  return `${numberWords(rounded)} feet${formal ? ' above ground level' : ''}`;
}

function vocalizeSpeedMph(mph) {
  return `${numberWords(mph)} miles per hour`;
}

function vocalizeSeconds(seconds) {
  const s = Math.round(seconds);
  return `${numberWords(s)} ${s === 1 ? 'second' : 'seconds'}`;
}

const ORDINAL_IRREGULAR = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

/** 1..31 -> "first", "third", "twelfth", "twentieth", "twenty-third". */
function ordinalWords(n) {
  const words = tensWords(n);
  const last = words.split('-').pop();
  const ordinalLast = ORDINAL_IRREGULAR[last]
    ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, words.length - last.length) + ordinalLast;
}

/** Year -> spoken pairs: 2026 -> "twenty twenty-six", 1999 -> "nineteen
 *  ninety-nine", 2007 -> "two-thousand and seven", 1900 -> "nineteen hundred". */
function vocalizeYear(year) {
  const hi = Math.floor(year / 100);
  const lo = year % 100;
  if (hi === 20 && lo < 10) return numberWords(year); // "two-thousand and seven"
  if (lo === 0) return `${tensWords(hi)} hundred`;
  if (lo < 10) return `${tensWords(hi)} oh ${ONES[lo]}`; // "nineteen oh seven"
  return `${tensWords(hi)} ${tensWords(lo)}`;
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?,\\s*(\\d{4})\\b`, 'g');

/** Dates -> spoken form: "July 23, 2026" -> "July twenty-third, twenty
 *  twenty-six". Weekday prefixes ("Friday, July 3, 2026") pass through
 *  untouched — they are already words. */
function vocalizeDate(text) {
  return text.replace(DATE_RE,
    (_, month, day, year) => `${month} ${ordinalWords(parseInt(day, 10))}, ${vocalizeYear(parseInt(year, 10))}`);
}

/** Acceleration in g -> "two point three gees", "three point seven five gees".
 *  Decimal digits are spoken individually; whole values skip the point. */
function vocalizeGees(value) {
  const [whole, frac] = String(value).split('.');
  let words = numberWords(parseInt(whole, 10));
  if (frac) {
    words += ' point ' + frac.split('').map(d => ONES[parseInt(d, 10)]).join(' ');
  }
  return `${words} gees`;
}

/** Narrator-boundary conversion: analyst statements are written English with
 *  digits ("Deployed at 2,970 ft, 65 seconds after exit. Opening peaked at
 *  3.7 g."); this rewrites the figures into house-style spoken words. */
function speakify(text) {
  return vocalizeDate(text)
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:ft|feet)\b(\s*AGL)?/gi,
      (_, num) => vocalizeAltitudeFt(parseFloat(num.replace(/,/g, ''))))
    .replace(/(\d+)\s*(?:to|–)\s*(\d+)\s*mph\b/gi,
      (_, a, b) => `${numberWords(parseInt(a, 10))} to ${vocalizeSpeedMph(parseInt(b, 10))}`)
    .replace(/(\d+)\s*mph\b/gi, (_, num) => vocalizeSpeedMph(parseInt(num, 10)))
    .replace(/(\d+)\s*(seconds|second)\b/gi, (_, num) => vocalizeSeconds(parseInt(num, 10)))
    .replace(/(\d+)\s*(meters|meter|degrees|degree)\b/gi, (_, num, unit) => `${numberWords(parseInt(num, 10))} ${unit.toLowerCase()}`)
    .replace(/(\d+(?:\.\d+)?)\s*g\b/g, (_, num) => vocalizeGees(num));
}

module.exports = {
  numberWords, vocalizeAltitudeFt, vocalizeSpeedMph, vocalizeSeconds,
  vocalizeGees, ordinalWords, vocalizeYear, vocalizeDate, speakify,
};
