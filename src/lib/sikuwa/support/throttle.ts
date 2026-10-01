import { hasKey, isNumeric, toInt, trimmedScalar } from '../internal/scalar';

/** Bentuk opsi `throttle` yang diterima pemanggil. */
export interface ThrottleSpec {
  max?: string | number | null;
  window?: string | number | null;
}

/**
 * Pembatas laju pengiriman: berapa pesan boleh keluar dalam satu jendela waktu.
 *
 * Berbeda dari `Pacing` yang mengatur jeda **antar** pesan di dalam satu batch,
 * kelas ini membatasi **jumlah** pesan — termasuk ketika pemanggil mengirim
 * satu pesan per request, yang justru pola paling sering dipakai aplikasi
 * nyata. Pacing tidak melihat kasus itu sama sekali: lima panggilan `send()`
 * terpisah tidak punya "pesan berikutnya" untuk diberi jeda.
 *
 * Pembatasnya bekerja dengan menahan pemanggil SEBELUM pesan dikirim, bukan
 * menolaknya: kalau jatah jendela ini habis, SDK menunggu sampai jendela
 * berikutnya terbuka. Menolak akan memaksa pemanggil menulis loop retry
 * sendiri — dan loop seperti itulah yang justru mempercepat pemblokiran.
 *
 * Bawaannya **mati**, sama seperti `Pacing` dan `Typing`: selama
 * `WHATSAPP_THROTTLE_MAX` kosong, {@link delayFor} mengembalikan null dan jalur
 * kirim berjalan persis seperti sebelum fitur ini ada.
 *
 * Batas laju ini **bukan jaminan bebas blokir**. WhatsApp menilai jauh lebih
 * banyak daripada kecepatan — umur akun, rasio pesan masuk-keluar, nomor yang
 * belum pernah dibalas, dan laporan penerima. Kelas ini hanya menjaga satu
 * variabel yang memang bisa dijaga dari sisi pengirim.
 */
export class Throttle {
  /**
   * Batas satu jeda tunggu, dalam detik.
   *
   * Salah tulis di .env — mis. `WHATSAPP_THROTTLE_MAX=10000` yang dimaksudkan
   * `100` — tidak boleh menahan proses pemanggil berjam-jam. Batas ini berlaku
   * sama seperti `Pacing.MAX_DELAY`.
   */
  static readonly MAX_WAIT = 600;

  private constructor(
    private readonly maxMessages: number,
    private readonly windowSeconds: number,
  ) {}

  /** Throttle yang tidak mengubah apa pun. */
  static none(): Throttle {
    return new Throttle(0, 60);
  }

  /**
   * Bangun dari isi environment: `100` dan `60`.
   *
   * Nilai yang tidak bisa dibaca memakai bawaannya, bukan mematikan
   * pembatasnya — sama seperti `Pacing.fromConfig()`, salah tulis satu kunci
   * tidak boleh membatalkan kunci lain.
   */
  static fromConfig(max: unknown, window: unknown = null): Throttle {
    return new Throttle(Throttle.parseMax(max), Throttle.parseWindow(window));
  }

  /** Bangun dari opsi pemanggil, mis. `{ max: 50, window: 60 }`. */
  static fromArray(spec: ThrottleSpec): Throttle {
    return Throttle.none().merge(spec);
  }

  /** Timpa sebagian nilai, tanpa menyentuh yang tidak disebutkan. */
  merge(spec?: ThrottleSpec | null): Throttle {
    if (spec === null || spec === undefined) return this;
    if (Object.keys(spec).length === 0) return this;

    return new Throttle(
      hasKey(spec, 'max') ? Throttle.parseMax(spec.max) : this.maxMessages,
      hasKey(spec, 'window') ? Throttle.parseWindow(spec.window) : this.windowSeconds,
    );
  }

  /** Apakah pembatas ini mengubah apa pun. */
  isEnabled(): boolean {
    return this.maxMessages > 0 && this.windowSeconds > 0;
  }

  /**
   * Jeda sebelum pesan ke-`index` boleh dikirim, dalam detik.
   *
   * Cara kerjanya sederhana dan sengaja tidak menyimpan keadaan: pesan
   * ke-`index` (mulai dari nol) di dalam satu batch dijadwalkan pada
   * `index ÷ max` jendela. Jadi dengan `max = 3` dan `window = 60`, tiga pesan
   * pertama langsung keluar, pesan ke-4 sampai ke-6 menunggu satu jendela, dan
   * seterusnya.
   *
   * Null berarti "tidak ada pembatasan", dan pemanggil yang memutuskan
   * berikutnya. Nol berarti "pembatas aktif, tapi pesan ini masih jatah jendela
   * yang sedang berjalan".
   *
   * @param index Posisi pesan di dalam batch, mulai dari nol.
   */
  delayFor(index: number): number | null {
    if (!this.isEnabled()) return null;

    const window = Math.trunc(Math.max(0, index) / this.maxMessages);

    return Math.min(Throttle.MAX_WAIT, window * this.windowSeconds);
  }

  /**
   * Jeda untuk satu batch berisi `count` pesan, bersiap dipakai berurutan.
   *
   * Dikembalikan sebagai daftar sepanjang `count` supaya pemanggil tinggal
   * membacanya per posisi — bentuk yang sama dengan hasil `Pacing`.
   *
   * Null pada tiap posisi ketika pembatasnya mati, bukan nol: null berarti
   * "tidak ada aturan", sedangkan nol berarti "aturan aktif, tapi pesan ini
   * masih jatah jendela yang berjalan". Pemanggil yang menggabungkannya dengan
   * pacing bergantung pada perbedaan itu.
   */
  schedule(count: number): (number | null)[] {
    const delays: (number | null)[] = [];

    for (let i = 0; i < count; i++) {
      delays.push(this.delayFor(i));
    }

    return delays;
  }

  /** Jumlah pesan yang boleh keluar dalam satu jendela. 0 berarti mati. */
  max(): number {
    return this.maxMessages;
  }

  /** Panjang jendela, detik. */
  window(): number {
    return this.windowSeconds;
  }

  /** Batas jumlah pesan; nilai tak terbaca atau nol mematikan pembatasnya. */
  private static parseMax(value: unknown): number {
    const text = trimmedScalar(value);

    return isNumeric(text) ? Math.max(0, toInt(text)) : 0;
  }

  /** Panjang jendela; nilai tak terbaca atau nol kembali ke bawaan 60 detik. */
  private static parseWindow(value: unknown): number {
    const text = trimmedScalar(value);

    return isNumeric(text) && toInt(text) > 0 ? toInt(text) : 60;
  }
}
