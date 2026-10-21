import { PhoneNumber } from './support/phone-number';

/**
 * Hasil pemeriksaan "nomor mana yang benar-benar terdaftar di WhatsApp",
 * dengan bentuk yang sama untuk semua gateway.
 *
 * WhatsApp tidak memberi tahu apakah sebuah nomor bisa dihubungi sebelum
 * pesannya benar-benar dikirim, dan menembak nomor yang tidak pernah ada
 * adalah salah satu pemicu pemblokiran yang paling sering. Objek inilah yang
 * menjawab pertanyaan itu, apa pun gateway yang dipakai:
 *
 * ```ts
 * const hasil = await client.checkNumbers(['081234567890', '089876543210']);
 *
 * for (const nomor of hasil.registered()) {
 *   await client.send({ destination: nomor, message: 'Halo' });
 * }
 * ```
 *
 * **Tanyakan selalu lewat {@link isRegistered}, bukan dengan membaca
 * {@link results} langsung.** Nomor di dalamnya sudah dinormalkan ke bentuk
 * internasional tanpa tanda plus (`62812…`), jadi kunci yang ditulis pemanggil
 * (`0812…`) tidak akan cocok apa adanya — method itulah yang menormalkannya
 * untuk Anda.
 *
 * Nomor yang tidak disebut gateway tidak muncul di sini: itu berarti **belum
 * terperiksa**, bukan "tidak terdaftar". {@link isRegistered} menjawab `false`
 * untuk keduanya, karena arah yang aman untuk pemakaiannya adalah tidak
 * mengirim.
 */
export class NumberCheck {
  constructor(
    /** Nama gateway yang memeriksa, mis. `OpenWA`. */
    readonly provider: string,
    /** Nomor (sudah dinormalkan) => terdaftar. */
    readonly results: Readonly<Record<string, boolean>> = {},
    /** Nomor => id WhatsApp kanonik (JID), untuk gateway yang menyebutkannya. */
    readonly ids: Readonly<Record<string, string>> = {},
    /**
     * Amplop asli gateway, untuk field khas gateway yang sengaja tidak ikut
     * dinormalkan. Gateway yang memeriksa satu nomor per panggilan mengisinya
     * dengan daftar balasan, bukan satu amplop.
     */
    readonly raw: unknown = {},
  ) {}

  /**
   * Apakah nomor ini terdaftar di WhatsApp.
   *
   * Nomornya boleh ditulis dalam bentuk apa pun yang lazim — `0812…`,
   * `+62 812…`, atau `62812…`. Nomor yang tidak ikut diperiksa, atau yang
   * tidak disebut gateway, dijawab `false`.
   */
  isRegistered(number: string): boolean {
    return this.results[PhoneNumber.normalize(number)] ?? false;
  }

  /**
   * Id WhatsApp kanonik sebuah nomor (`62812…@s.whatsapp.net`), bila gateway
   * menyebutkannya. String kosong berarti gateway tidak menyediakannya —
   * bukan bahwa nomornya tidak ada.
   */
  whatsappId(number: string): string {
    const id = this.ids[PhoneNumber.normalize(number)];

    return typeof id === 'string' ? id : '';
  }

  /** Nomor yang terdaftar, siap dipakai sebagai daftar tujuan. */
  registered(): string[] {
    return keysWhere(this.results, true);
  }

  /**
   * Nomor yang dipastikan **tidak** terdaftar. Nomor yang belum terperiksa
   * tidak muncul di sini, supaya daftar ini tidak pernah melebih-lebihkan apa
   * yang sebenarnya diketahui gateway.
   */
  unregistered(): string[] {
    return keysWhere(this.results, false);
  }

  /** Apakah gateway tidak memberi jawaban apa pun. */
  isEmpty(): boolean {
    return Object.keys(this.results).length === 0;
  }

  /**
   * Bentuk ringkas `nomor => terdaftar`, aman dicatat ke log.
   *
   * Pakai {@link registered} kalau yang dibutuhkan adalah daftar nomor dalam
   * bentuk string.
   */
  toArray(): Record<string, boolean> {
    return { ...this.results };
  }

  /**
   * Hasilnya sebagai JSON.
   *
   * Hasil yang kosong tetap tercetak sebagai `{}`, bukan `[]` — yang
   * dikembalikan di sini adalah peta `nomor => terdaftar`, bukan daftar.
   */
  toJson(): string {
    return JSON.stringify(this.toArray());
  }

  /** Ringkasan siap catat ke log, mis. `"OpenWA: 2 terdaftar, 1 tidak terdaftar"`. */
  toString(): string {
    return `${this.provider}: ${this.registered().length} terdaftar, ${
      this.unregistered().length
    } tidak terdaftar`;
  }
}

/** Kunci yang nilainya sama dengan `expected`, dikembalikan sebagai string. */
function keysWhere(results: Readonly<Record<string, boolean>>, expected: boolean): string[] {
  return Object.keys(results).filter((number) => results[number] === expected);
}
