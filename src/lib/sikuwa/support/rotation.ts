import { validateBoolean } from '../internal/scalar';

/** Bentuk opsi `rotate` yang diterima pemanggil. */
export interface RotationSpec {
  /** Bawaannya `true` — menulis kuncinya saja sudah berarti menyalakan. */
  enabled?: unknown;
}

/**
 * Pembagian batch pesan ke beberapa gateway sekaligus.
 *
 * Berangkat dari satu perilaku `auto` yang mudah terlewat: undian gateway
 * terjadi **sekali per panggilan**, jadi satu `send()` berisi seratus pesan
 * tetap keluar lewat satu gateway saja. Untuk pengiriman massal itu justru
 * pola yang paling cepat menabrak batas laju gateway — semua beban menumpuk di
 * satu perangkat, padahal gateway lain sudah dikonfigurasi dan menganggur.
 *
 * Saat fitur ini menyala, batch dibagi ke **semua** gateway yang punya token:
 *
 * - Urutan gatewaynya **diundi tiap panggilan**, jadi gateway mana yang
 *   mendapat bagian lebih banyak tidak pernah tetap. Rotasi yang urutannya
 *   selalu sama justru lebih mudah dikenali daripada tidak berotasi.
 * - Pembagiannya **bergiliran**, sehingga jumlah pesan tiap gateway berbeda
 *   paling banyak satu. Undian murni per pesan terlihat lebih "acak", tetapi
 *   ia bisa menaruh 90 dari 100 pesan di satu gateway — yang berarti fiturnya
 *   gagal tepat pada satu-satunya alasan ia dinyalakan.
 *
 * Bawaannya **mati**. Selama `WHATSAPP_ROTATE` tidak diisi, `Client.send()`
 * berjalan persis seperti sebelum fitur ini ada.
 *
 * Yang **tidak** diurus kelas ini: kapan rotasi dipakai. Itu keputusan
 * `Client` — kelas ini murni aritmetika pembagian, tanpa jaringan dan tanpa
 * konfigurasi lain, supaya bisa diuji sendiri.
 */
export class Rotation {
  private constructor(private readonly enabled: boolean) {}

  /** Rotasi yang tidak mengubah apa pun. */
  static off(): Rotation {
    return new Rotation(false);
  }

  /**
   * Bangun dari isi environment: `WHATSAPP_ROTATE=1`.
   *
   * Apa pun yang tidak dikenali berarti **mati** — sama seperti
   * `WHATSAPP_CHECK_NUMBERS`. Salah tulis satu kunci tidak boleh tiba-tiba
   * memindahkan separuh pesan ke gateway lain.
   */
  static fromConfig(enabled: unknown): Rotation {
    return new Rotation(validateBoolean(enabled));
  }

  /**
   * Bangun dari opsi pemanggil, mis. `{ enabled: true }`.
   *
   * Bentuknya sengaja dibuat sama dengan `Typing.fromArray()` supaya dua
   * pengaturan yang bersebelahan di `.env` tidak menuntut dua cara penulisan
   * yang berbeda.
   */
  static fromArray(spec: RotationSpec): Rotation {
    return new Rotation(validateBoolean(spec.enabled ?? true));
  }

  /** Apakah satu batch boleh dibagi ke beberapa gateway. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Bagi `count` pesan ke `gateways`, bergiliran setelah diundi.
   *
   * Hasilnya memetakan nama gateway ke **posisi** pesan di batch asal, bukan
   * ke pesannya sendiri: pemanggil yang memegang daftarnya, dan memindahkan
   * isi pesan ke sini hanya akan membuat dua salinan yang bisa berbeda.
   *
   * Urutan kunci hasil mengikuti urutan undian — itulah urutan gateway
   * dipakai mengirim, dan bagian yang kosong tidak pernah muncul. Daftar
   * gateway yang kosong atau satu pesan saja menghasilkan hasil kosong:
   * tidak ada yang bisa dibagi.
   *
   * @param gateways Nama gateway, tanpa duplikat.
   * @returns Nama gateway => posisi pesan, menaik.
   */
  assign(count: number, gateways: string[]): Record<string, number[]> {
    const unique = [...new Set(gateways)];

    if (!this.enabled || count <= 0 || unique.length === 0) {
      return {};
    }

    const shuffled = shuffle(unique);
    const slices: Record<string, number[]> = {};

    for (let i = 0; i < count; i++) {
      const name = shuffled[i % shuffled.length];

      (slices[name] ??= []).push(i);
    }

    return slices;
  }
}

/**
 * `shuffle()` PHP — Fisher-Yates, mengubah salinan.
 *
 * Salinan dibuat di pemanggil (`[...new Set(...)]`), jadi tidak ada daftar
 * milik pemanggil yang ikut teracak.
 */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}
