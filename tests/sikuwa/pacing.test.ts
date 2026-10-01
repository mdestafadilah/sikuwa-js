import { afterEach, describe, expect, test } from 'bun:test';
import { Config } from '../../src/lib/sikuwa/config';
import { Pacing } from '../../src/lib/sikuwa/support/pacing';
import { Text } from '../../src/lib/sikuwa/support/text';

/**
 * Porting dari `tests/PacingTest.php`, bagian nilai — yaitu seluruh keputusan
 * "berapa detik" tanpa menyentuh jaringan.
 *
 * Bagian "penerapan saat mengirim" pada berkas aslinya menuntut provider, jadi
 * ia menyusul bersama provider pilot; di sini yang dibuktikan adalah
 * aritmetikanya: siklus bergiliran, jitter acak, pengali pesan panjang, dan
 * penggabungan opsi per panggilan.
 */
function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

afterEach(() => {
  Config.useResolver(null);
});

describe('Pacing — sebagai nilai', () => {
  test('pacing yang mati tidak mengubah apa pun', () => {
    const pacing = Pacing.none();

    expect(pacing.isEnabled()).toBe(false);
    expect(pacing.delayFor(0)).toBeNull();
    expect(pacing.delayFor(7)).toBeNull();
  });

  test('nilai konfigurasi kosong berarti mati', () => {
    expect(Pacing.fromConfig(null, null).isEnabled()).toBe(false);
    expect(Pacing.fromConfig('', '').isEnabled()).toBe(false);
    expect(Pacing.fromConfig('abc', 'xyz').isEnabled()).toBe(false);
  });

  test('siklus bergiliran', () => {
    const pacing = Pacing.fromConfig('0,30', null);

    expect(pacing.cycle()).toEqual([0, 30]);
    expect([0, 1, 2, 3, 4, 5].map((i) => pacing.delayFor(i))).toEqual([0, 30, 0, 30, 0, 30]);
  });

  test('siklus menerima spasi dan melewati sampah', () => {
    expect(Pacing.fromConfig(' 0 , 30 ', null).cycle()).toEqual([0, 30]);
    expect(Pacing.fromConfig([5], null).cycle()).toEqual([5]);
    expect(Pacing.fromConfig('7, ?, 0', null).cycle()).toEqual([7, 0]);
  });

  test('interval sendirian acak di dalam batasnya', () => {
    const pacing = Pacing.fromConfig(null, '20-30');
    const samples: number[] = [];

    for (let i = 0; i < 200; i++) samples.push(pacing.delayFor(0) as number);

    expect(pacing.interval()).toEqual({ min: 20, max: 30 });
    expect(Math.max(...samples)).toBeGreaterThan(20);
    expect(Math.min(...samples)).toBeLessThan(30);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...samples)).toBeLessThanOrEqual(30);
  });

  test('interval ditambahkan ke siklus, bukan menggantikannya', () => {
    const pacing = Pacing.fromConfig('0,30', '20-30');

    for (let i = 0; i < 100; i++) {
      const genap = pacing.delayFor(0) as number;
      const ganjil = pacing.delayFor(1) as number;

      expect(genap).toBeGreaterThanOrEqual(20);
      expect(genap).toBeLessThanOrEqual(30);
      expect(ganjil).toBeGreaterThanOrEqual(50);
      expect(ganjil).toBeLessThanOrEqual(60);
    }
  });

  test('interval berupa satu angka berarti jeda tetap', () => {
    expect(Pacing.fromConfig(null, '25').interval()).toEqual({ min: 25, max: 25 });
    expect(Pacing.fromConfig(null, '25').delayFor(3)).toBe(25);
  });

  test('rentang terbalik dibetulkan', () => {
    expect(Pacing.fromConfig(null, '30-20').interval()).toEqual({ min: 20, max: 30 });
  });

  test('interval menerima bentuk array', () => {
    expect(Pacing.fromConfig(null, [20, 30]).interval()).toEqual({ min: 20, max: 30 });
    expect(Pacing.fromConfig(null, [4]).interval()).toEqual({ min: 4, max: 4 });
  });

  test('jeda dijepit ke batas maksimum', () => {
    const pacing = Pacing.fromConfig(String(Pacing.MAX_DELAY * 2), null);

    expect(pacing.cycle()).toEqual([Pacing.MAX_DELAY]);
    expect(Pacing.fromConfig(null, '9999').delayFor(0)).toBe(Pacing.MAX_DELAY);
  });

  test('merge hanya menyentuh kunci yang disebutkan', () => {
    const config = Pacing.fromConfig('0,30', '20-30');

    // Interval dimatikan, siklus dari konfigurasi tetap dipakai.
    const onlyCycle = config.merge({ interval: null });
    expect(onlyCycle.cycle()).toEqual([0, 30]);
    expect(onlyCycle.interval()).toBeNull();
    expect(onlyCycle.delayFor(1)).toBe(30);

    // Siklus diganti, interval dari konfigurasi tetap dipakai.
    const replaced = config.merge({ cycle: '5' });
    expect(replaced.cycle()).toEqual([5]);
    expect(replaced.interval()).toEqual({ min: 20, max: 30 });
  });

  test('merge tanpa apa-apa mengembalikan instance yang sama', () => {
    const pacing = Pacing.fromConfig('0,30', null);

    expect(pacing.merge(null)).toBe(pacing);
    expect(pacing.merge({})).toBe(pacing);
  });
});

describe('Pacing — pesan panjang', () => {
  test('isi pesan panjang melipatkan jedanya', () => {
    const pacing = Pacing.fromConfig('0,30', null);

    expect(pacing.longChars()).toBe(Pacing.DEFAULT_LONG_CHARS);
    expect(pacing.longFactor()).toBe(Pacing.DEFAULT_LONG_FACTOR);

    // Pesan pendek: siklus apa adanya.
    expect(pacing.delayFor(0, 100)).toBe(0);
    expect(pacing.delayFor(1, 100)).toBe(30);

    // Pesan panjang: siklus dikali pengali.
    expect(pacing.delayFor(0, 400)).toBe(0);
    expect(pacing.delayFor(1, 400)).toBe(90);
  });

  test('ambang pesan panjang inklusif', () => {
    const pacing = Pacing.fromConfig('10', null);

    expect(pacing.isLong(299)).toBe(false);
    expect(pacing.isLong(300)).toBe(true);
    expect(pacing.delayFor(0, 299)).toBe(10);
    expect(pacing.delayFor(0, 300)).toBe(30);
  });

  test('aturan pesan panjang bisa dimatikan', () => {
    // Ambang 0 mematikan aturannya, sepanjang apa pun pesannya.
    const off = Pacing.fromConfig('10', null, 0, 5);
    expect(off.isLong(9999)).toBe(false);
    expect(off.delayFor(0, 9999)).toBe(10);

    // Pengali 1 berarti tidak mengalikan apa pun.
    const flat = Pacing.fromConfig('10', null, 300, 1);
    expect(flat.isLong(500)).toBe(true);
    expect(flat.delayFor(0, 500)).toBe(10);
  });

  test('nilai pesan panjang bisa diatur dan aman terhadap salah tulis', () => {
    const custom = Pacing.fromConfig('10', null, '50', '2');

    expect(custom.longChars()).toBe(50);
    expect(custom.longFactor()).toBe(2);
    expect(custom.delayFor(0, 50)).toBe(20);

    // Nilai tak terbaca kembali ke bawaan, tidak mematikan pacing-nya.
    const broken = Pacing.fromConfig('10', null, 'abc', 'xyz');

    expect(broken.longChars()).toBe(Pacing.DEFAULT_LONG_CHARS);
    expect(broken.longFactor()).toBe(Pacing.DEFAULT_LONG_FACTOR);
  });

  test('jeda pesan panjang tetap dijepit ke batas maksimum', () => {
    const pacing = Pacing.fromConfig(String(Pacing.MAX_DELAY), null);

    expect(pacing.delayFor(0, 9999)).toBe(Pacing.MAX_DELAY);
  });

  test('merge menangani kunci pesan panjang', () => {
    const pacing = Pacing.fromConfig('10', null).merge({ long_chars: 5, long_factor: 2 });

    expect(pacing.longChars()).toBe(5);
    expect(pacing.longFactor()).toBe(2);
    expect(pacing.delayFor(0, 5)).toBe(20);

    // Yang tidak disebutkan tidak disentuh.
    expect(Pacing.fromConfig('10', null).merge({ long_factor: 2 }).longChars()).toBe(
      Pacing.DEFAULT_LONG_CHARS,
    );
  });

  test('panjang dihitung dalam karakter, bukan byte', () => {
    expect(Text.length('ééé')).toBe(3);
    expect(new TextEncoder().encode('ééé').length).toBe(6);
  });
});

describe('Pacing — dari Config', () => {
  test('membaca pacing dari environment', () => {
    fakeEnv({ WHATSAPP_PACING_CYCLE: '0,30', WHATSAPP_PACING_INTERVAL: '20-30' });

    const pacing = Config.fromEnvironment().pacing();

    expect(pacing.isEnabled()).toBe(true);
    expect(pacing.cycle()).toEqual([0, 30]);
    expect(pacing.interval()).toEqual({ min: 20, max: 30 });
  });

  test('pacing mati kalau kuncinya tidak ada', () => {
    fakeEnv({});

    expect(new Config().pacing().isEnabled()).toBe(false);
  });

  test('membaca kunci pesan panjang dari environment', () => {
    fakeEnv({
      WHATSAPP_PACING_CYCLE: '0,30',
      WHATSAPP_PACING_LONG_CHARS: '120',
      WHATSAPP_PACING_LONG_FACTOR: '4',
    });

    const pacing = Config.fromEnvironment().pacing();

    expect(pacing.longChars()).toBe(120);
    expect(pacing.longFactor()).toBe(4);
    expect(pacing.isLong(119)).toBe(false);
    expect(pacing.isLong(120)).toBe(true);
  });

  test('opsi pacing menerima array', () => {
    fakeEnv({ WHATSAPP_PACING_CYCLE: '0,30' });

    const pacing = Config.from({ pacing: { interval: '20-30' } }).pacing();

    // Nilai eksplisit menang utuh: siklus dari environment tidak ikut.
    expect(pacing.cycle()).toEqual([]);
    expect(pacing.interval()).toEqual({ min: 20, max: 30 });
  });

  test('opsi pacing menerima instance Pacing', () => {
    const pacing = Config.from({ pacing: Pacing.fromConfig('3', null) }).pacing();

    expect(pacing.cycle()).toEqual([3]);
  });

  test('opsi pacing eksplisit menang atas environment', () => {
    fakeEnv({ WHATSAPP_PACING_CYCLE: '0,30' });

    expect(new Config({ pacing: Pacing.none() }).pacing().isEnabled()).toBe(false);
  });
});
