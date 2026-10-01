import { afterEach, describe, expect, test } from 'bun:test';
import { Config } from '../../src/lib/sikuwa/config';
import { Throttle } from '../../src/lib/sikuwa/support/throttle';

/**
 * Porting dari `tests/ThrottleTest.php`, bagian nilai.
 *
 * Yang dibuktikan: jendela dibuka per kelompok, salah tulis di `.env` tidak
 * menahan pemanggil berjam-jam, dan opsi pemanggil menang atas environment.
 * Bagian "throttle menahan pemanggil" menuntut provider, jadi menyusul.
 */
function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

afterEach(() => {
  Config.useResolver(null);
});

describe('Throttle', () => {
  test('bawaannya mati', () => {
    const throttle = Throttle.fromConfig(null);

    expect(throttle.isEnabled()).toBe(false);
    expect(throttle.delayFor(0)).toBeNull();
    expect(throttle.delayFor(500)).toBeNull();
  });

  test('satu jendela dibuka per kelompok', () => {
    const throttle = Throttle.fromConfig('3', '60');

    expect(throttle.delayFor(0)).toBe(0);
    expect(throttle.delayFor(1)).toBe(0);
    expect(throttle.delayFor(2)).toBe(0);
    expect(throttle.delayFor(3)).toBe(60);
    expect(throttle.delayFor(5)).toBe(60);
    expect(throttle.delayFor(6)).toBe(120);
    expect(throttle.delayFor(8)).toBe(120);
  });

  test.each([
    ['kosong berarti mati', null, null, false],
    ['max saja', '50', null, true],
    ['max dan window', '50', '60', true],
    ['max nol berarti mati', '0', '60', false],
    ['max bukan angka berarti mati', 'abc', null, false],
  ] as const)('dibaca dari environment: %s', (_label, max, window, expected) => {
    const values: Record<string, string> = {};
    if (max !== null) values['WHATSAPP_THROTTLE_MAX'] = max;
    if (window !== null) values['WHATSAPP_THROTTLE_WINDOW'] = window;

    fakeEnv(values);

    expect(Config.fromEnvironment().throttle().isEnabled()).toBe(expected);
  });

  test('jeda tunggu dijepit', () => {
    const throttle = Throttle.fromConfig('1', '99999');

    expect(throttle.delayFor(2)).toBe(Throttle.MAX_WAIT);
  });

  test('panjang jendela kembali ke enam puluh detik bila tidak sah', () => {
    expect(Throttle.fromConfig('5', '0').window()).toBe(60);
    expect(Throttle.fromConfig('5', 'abc').window()).toBe(60);
  });

  test('opsi throttle menang atas environment', () => {
    fakeEnv({ WHATSAPP_THROTTLE_MAX: '10' });

    const throttle = Config.from({ throttle: { max: 99, window: 30 } }).throttle();

    expect(throttle.max()).toBe(99);
    expect(throttle.window()).toBe(30);
  });

  test('schedule mengembalikan satu nilai per posisi', () => {
    const throttle = Throttle.fromConfig('2', '30');

    expect(throttle.schedule(5)).toEqual([0, 0, 30, 30, 60]);
  });

  test('schedule memakai null saat pembatasnya mati', () => {
    expect(Throttle.fromConfig(null).schedule(3)).toEqual([null, null, null]);
  });

  test('merge hanya menyentuh kunci yang disebutkan', () => {
    const throttle = Throttle.fromConfig('10', '60');

    const replaced = throttle.merge({ max: 2 });
    expect(replaced.max()).toBe(2);
    expect(replaced.window()).toBe(60);

    expect(throttle.merge(null)).toBe(throttle);
    expect(throttle.merge({})).toBe(throttle);
  });
});
