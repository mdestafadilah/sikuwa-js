import { describe, expect, test } from 'bun:test';
import { Rotation } from '../../../src/lib/sikuwa/support/rotation';

/**
 * Porting dari `tests/Support/RotationTest.php`.
 *
 * Yang diuji di sini murni aritmetikanya — siapa dapat berapa, dan apakah
 * undiannya benar-benar berubah antar panggilan. Jalan ceritanya (batch
 * benar-benar keluar lewat beberapa gateway) ada di `provider-rotation.test.ts`.
 */

const TIGA = ['OpenWA', 'Wuzapi', 'Wwebjs'];

describe('Rotation — saklar dan pembagian batch', () => {
  test('rotasi mati kecuali kuncinya mengatakan lain', () => {
    expect(Rotation.fromConfig(null).isEnabled()).toBe(false);
    expect(Rotation.fromConfig('').isEnabled()).toBe(false);
    expect(Rotation.fromConfig('0').isEnabled()).toBe(false);
    expect(Rotation.fromConfig('salah tulis').isEnabled()).toBe(false);
    expect(Rotation.off().isEnabled()).toBe(false);

    expect(Rotation.fromConfig('1').isEnabled()).toBe(true);
    expect(Rotation.fromConfig('true').isEnabled()).toBe(true);
    expect(Rotation.fromConfig(true).isEnabled()).toBe(true);
  });

  /**
   * Menyebut kunci `enabled` saja sudah dianggap permintaan untuk menyalakan —
   * sama seperti `Typing.fromArray()`, supaya dua pengaturan bersebelahan tidak
   * menuntut dua cara penulisan.
   */
  test('opsi array menyalakan kecuali dimatikan tegas', () => {
    expect(Rotation.fromArray({}).isEnabled()).toBe(true);
    expect(Rotation.fromArray({ enabled: true }).isEnabled()).toBe(true);
    expect(Rotation.fromArray({ enabled: false }).isEnabled()).toBe(false);
  });

  test('rotasi mati tidak pernah membagi apa pun', () => {
    expect(Rotation.off().assign(10, TIGA)).toEqual({});
  });

  test('tanpa gateway atau tanpa pesan tidak ada yang dibagi', () => {
    const rotation = Rotation.fromConfig('1');

    expect(rotation.assign(0, TIGA)).toEqual({});
    expect(rotation.assign(5, [])).toEqual({});
  });

  /**
   * Pembagiannya bergiliran, jadi selisih jumlah antar gateway paling banyak
   * satu — tidak ada gateway yang kebagian nol selama pesannya lebih banyak
   * daripada gatewaynya.
   */
  test('pembagian seimbang dan mencakup setiap pesan tepat sekali', () => {
    const slices = Rotation.fromConfig('1').assign(7, TIGA);
    const names = Object.keys(slices);

    expect(names.length).toBe(3);

    const jumlah = names.map((name) => slices[name].length).sort((a, b) => a - b);

    expect(jumlah).toEqual([2, 2, 3]);

    const semua = Object.values(slices).flat().sort((a, b) => a - b);

    expect(semua).toEqual([0, 1, 2, 3, 4, 5, 6]);

    for (const name of names) {
      expect(new Set(slices[name]).size).toBe(slices[name].length);
    }
  });

  test('satu pesan jatuh ke tepat satu gateway', () => {
    const slices = Rotation.fromConfig('1').assign(1, TIGA);

    expect(Object.keys(slices).length).toBe(1);
    expect(Object.values(slices)).toEqual([[0]]);
  });

  test('nama gateway yang berulang tidak diduplikasi', () => {
    const slices = Rotation.fromConfig('1').assign(2, ['OpenWA', 'OpenWA', 'OpenWA']);

    expect(Object.keys(slices).length).toBe(1);
    expect(Object.values(slices)).toEqual([[0, 1]]);
  });

  /**
   * Urutannya diundi tiap panggilan.
   *
   * Rotasi yang urutannya selalu sama lebih mudah dikenali daripada tidak
   * berotasi sama sekali — gateway pertama selalu kebagian pesan pertama. Yang
   * diperiksa di sini bukan undian tertentu, melainkan bahwa hasilnya memang
   * tidak tetap: dengan lima gateway ada 120 urutan, jadi tiga puluh panggilan
   * yang selalu sama mustahil terjadi kalau undiannya benar.
   */
  test('urutan gateway diundi ulang tiap panggilan', () => {
    const rotation = Rotation.fromConfig('1');
    const lima = ['Fonnte', 'OpenWA', 'ApiMe', 'EvolutionAPI', 'Wuzapi'];
    const terlihat = new Set<string>();

    for (let i = 0; i < 30; i++) {
      terlihat.add(Object.keys(rotation.assign(5, lima)).join(','));
    }

    expect(terlihat.size).toBeGreaterThan(1);
  });
});
