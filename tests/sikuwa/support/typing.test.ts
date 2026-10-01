import { describe, expect, test } from 'bun:test';
import { Typing } from '../../../src/lib/sikuwa/support/typing';

/**
 * Porting dari `tests/Support/TypingTest.php`.
 *
 * Yang diuji murni aritmetikanya — berapa detik untuk pesan sekian karakter,
 * dan bagaimana salah tulis di `.env` disikapi. Jalan ceritanya (indikator
 * benar-benar dikirim sebelum pesan) ada di tes tingkat provider.
 */
describe('Typing', () => {
  test.each([
    ['satu karakter tetap dua detik', 1, 2],
    ['sepuluh karakter', 10, 2],
    ['enam puluh karakter', 60, 4],
    ['seratus lima puluh karakter', 150, 10],
    ['tiga ratus karakter', 300, 20],
    ['lima ribu karakter tetap dua puluh', 5000, 20],
  ] as const)('lama indikator mengikuti panjang pesan: %s', (_label, karakter, harapan) => {
    expect(Typing.fromConfig('1').durationFor(karakter)).toBe(harapan);
  });

  test('fitur mati kecuali diminta', () => {
    const typing = Typing.off();

    expect(typing.isEnabled()).toBe(false);
    expect(typing.durationFor(300)).toBeNull();
  });

  test('kunci pengaturan saja tidak menyalakannya', () => {
    const typing = Typing.fromConfig(null, '5', '1', '60');

    expect(typing.isEnabled()).toBe(false);
    expect(typing.durationFor(300)).toBeNull();
  });

  test('menyebut kunci typing di dalam panggilan berarti memintanya', () => {
    expect(Typing.fromArray({ speed: 8 }).isEnabled()).toBe(true);
    expect(Typing.fromArray({ enabled: true }).isEnabled()).toBe(true);
  });

  test('pemanggil bisa mematikannya secara eksplisit', () => {
    const typing = Typing.fromArray({ enabled: false, speed: 8 });

    expect(typing.isEnabled()).toBe(false);
    expect(typing.durationFor(300)).toBeNull();
  });

  test.each([
    ['angka satu', '1', true],
    ['true', 'true', true],
    ['on', 'on', true],
    ['yes', 'yes', true],
    ['huruf besar', 'TRUE', true],
    ['angka nol', '0', false],
    ['false', 'false', false],
    ['off', 'off', false],
    ['kosong', '', false],
    ['tidak diisi', null, false],
  ] as const)('saklar menerima ejaan yang lazim: %s', (_label, nilai, harapan) => {
    expect(Typing.fromConfig(nilai).isEnabled()).toBe(harapan);
  });

  test('kecepatan ketik datang dari environment', () => {
    const typing = Typing.fromConfig('1', '5');

    expect(typing.speed()).toBe(5);
    // 50 karakter ÷ 5 karakter/detik.
    expect(typing.durationFor(50)).toBe(10);
  });

  test('lama terpendek dan terpanjang bisa diatur', () => {
    const typing = Typing.fromConfig('1', '15', '5', '60');

    expect(typing.min()).toBe(5);
    expect(typing.max()).toBe(60);
    expect(typing.durationFor(1)).toBe(5);
    expect(typing.durationFor(5000)).toBe(60);
  });

  test('pesan kosong tidak perlu indikator', () => {
    const typing = Typing.fromConfig('1');

    expect(typing.durationFor(0)).toBe(0);
    expect(typing.durationFor(-5)).toBe(0);
  });

  test('nilai tak terbaca kembali ke bawaannya', () => {
    const typing = Typing.fromConfig('1', 'cepat', 'dua', 'tiga');

    // Salah tulis satu kunci tidak boleh membatalkan kunci lain.
    expect(typing.isEnabled()).toBe(true);
    expect(typing.speed()).toBe(Typing.DEFAULT_SPEED);
    expect(typing.min()).toBe(Typing.DEFAULT_MIN);
    expect(typing.max()).toBe(Typing.DEFAULT_MAX);
  });

  test('batas maksimum yang keterlaluan dijepit', () => {
    const typing = Typing.fromConfig('1', '15', '2', '20000');

    expect(typing.max()).toBe(Typing.MAX_SECONDS);
    expect(typing.durationFor(999999)).toBe(Typing.MAX_SECONDS);
  });

  test('kecepatan nol tidak membuat pembagian gagal', () => {
    const typing = Typing.fromConfig('1', '0');

    expect(typing.speed()).toBe(1);
    expect(typing.durationFor(300)).toBe(Typing.DEFAULT_MAX);
  });

  test('lama terpanjang tidak pernah di bawah yang terpendek', () => {
    const typing = Typing.fromConfig('1', '15', '30', '5');

    expect(typing.min()).toBe(5);
    expect(typing.max()).toBe(30);
  });

  test('merge menyimpan yang tidak disebut pemanggil', () => {
    const typing = Typing.fromArray({ speed: 10, max: 30 }).merge({ min: 5 });

    expect(typing.speed()).toBe(10);
    expect(typing.max()).toBe(30);
    expect(typing.min()).toBe(5);
  });

  test('penimpaan kosong tidak mengubah apa pun', () => {
    const typing = Typing.fromArray({ speed: 10 });

    expect(typing.merge(null)).toBe(typing);
    expect(typing.merge({})).toBe(typing);
  });

  test('spec kosong berarti mati', () => {
    expect(Typing.fromArray({}).isEnabled()).toBe(false);
  });
});
