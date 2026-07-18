// House-style vocalization for narration (see .claude/skills/narrator).

const {
  numberWords, vocalizeAltitudeFt, vocalizeSpeedMph, vocalizeSeconds,
  vocalizeGees, ordinalWords, vocalizeYear, vocalizeDate, speakify,
} = require('./vocalize');

describe('vocalize', () => {
  it('speaks altitudes in house style, AGL dropped by default', () => {
    expect(vocalizeAltitudeFt(13590)).toBe('thirteen-thousand, five-hundred and ninety feet');
    expect(vocalizeAltitudeFt(2430)).toBe('two-thousand, four-hundred and thirty feet');
  });

  it('rounds altitudes to the nearest 10 feet', () => {
    expect(vocalizeAltitudeFt(13634.2)).toBe('thirteen-thousand, six-hundred and thirty feet');
    expect(vocalizeAltitudeFt(2974.8)).toBe('two-thousand, nine-hundred and seventy feet');
  });

  it('keeps the ground reference only when formal', () => {
    expect(vocalizeAltitudeFt(2430, { formal: true }))
      .toBe('two-thousand, four-hundred and thirty feet above ground level');
  });

  it('handles exact thousands and small remainders', () => {
    expect(vocalizeAltitudeFt(13000)).toBe('thirteen-thousand feet');
    expect(numberWords(12065)).toBe('twelve-thousand and sixty-five');
    expect(numberWords(110)).toBe('one-hundred and ten');
    expect(numberWords(90)).toBe('ninety');
  });

  it('speaks speeds and durations', () => {
    expect(vocalizeSpeedMph(134)).toBe('one-hundred and thirty-four miles per hour');
    expect(vocalizeSeconds(65.3)).toBe('sixty-five seconds');
    expect(vocalizeSeconds(1)).toBe('one second');
  });

  it('speaks acceleration readings as gees with spelled-out decimal digits', () => {
    expect(vocalizeGees('2.3')).toBe('two point three gees');
    expect(vocalizeGees('3.75')).toBe('three point seven five gees');
    expect(vocalizeGees('5')).toBe('five gees');
  });

  it('speaks day-of-month ordinals', () => {
    expect(ordinalWords(1)).toBe('first');
    expect(ordinalWords(3)).toBe('third');
    expect(ordinalWords(12)).toBe('twelfth');
    expect(ordinalWords(20)).toBe('twentieth');
    expect(ordinalWords(23)).toBe('twenty-third');
    expect(ordinalWords(31)).toBe('thirty-first');
  });

  it('speaks years in pairs', () => {
    expect(vocalizeYear(2026)).toBe('twenty twenty-six');
    expect(vocalizeYear(1999)).toBe('nineteen ninety-nine');
    expect(vocalizeYear(2007)).toBe('two-thousand and seven');
    expect(vocalizeYear(1907)).toBe('nineteen oh seven');
    expect(vocalizeYear(1900)).toBe('nineteen hundred');
  });

  it('speaks dates, passing weekday prefixes through', () => {
    expect(vocalizeDate('July 23, 2026')).toBe('July twenty-third, twenty twenty-six');
    expect(vocalizeDate('July 3, 2026')).toBe('July third, twenty twenty-six');
    expect(vocalizeDate('Friday, July 3, 2026, at Skydive Spaceland.'))
      .toBe('Friday, July third, twenty twenty-six, at Skydive Spaceland.');
    expect(vocalizeDate('no date here')).toBe('no date here');
  });

  it('speakifies analyst statements at the narrator boundary', () => {
    expect(speakify('Deployed at 2,970 ft, 65 seconds after exit.'))
      .toBe('Deployed at two-thousand, nine-hundred and seventy feet, sixty-five seconds after exit.');
    expect(speakify('Freefall peaked at 134 mph.'))
      .toBe('Freefall peaked at one-hundred and thirty-four miles per hour.');
    expect(speakify('below the 2,500 ft C and D license floor'))
      .toBe('below the two-thousand, five-hundred feet C and D license floor');
    expect(speakify('Opening peaked at 3.7 g.')).toBe('Opening peaked at three point seven gees.');
    expect(speakify('a landing impulse of 2.3 g — a hard landing'))
      .toBe('a landing impulse of two point three gees — a hard landing');
    expect(speakify('First jump since July 23, 2026.'))
      .toBe('First jump since July twenty-third, twenty twenty-six.');
    expect(speakify('inside the 115 to 125 mph average-jumper range'))
      .toBe('inside the one-hundred and fifteen to one-hundred and twenty-five miles per hour average-jumper range');
    expect(speakify('The canopy opened 165 degrees off heading.'))
      .toBe('The canopy opened one-hundred and sixty-five degrees off heading.');
    expect(speakify('540 degrees of yaw under a peak load of 1.8 g.'))
      .toBe('five-hundred and forty degrees of yaw under a peak load of one point eight gees.');
  });
});
