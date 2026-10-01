import { hasKey, isNumeric, toInt, trimmedScalar, validateBoolean } from '../internal/scalar';

/** Bentuk opsi `typing` yang diterima pemanggil. */
export interface TypingSpec {
  enabled?: unknown;
  speed?: string | number | null;
  min?: string | number | null;
  max?: string | number | null;
}

/**
 * Pengatur indikator "sedang mengetik" yang dimunculkan SDK sendiri sebelum
 * sebuah pesan dikirim.
 *
 * Berangkat dari masalah yang sama di semua gateway: pesan yang muncul
 * seketika setelah request terbaca sebagai robot. Manusia mengetik dulu,
 * penerima melihat "sedang mengetik", baru pesannya datang. Fitur ini meniru
 * bagian itu — dan lamanya **mengikuti panjang pesan**, karena pesan 300
 * karakter yang "diketik" dalam satu detik sama tidak wajarnya dengan "Halo"
 * yang diketipkan sepuluh detik.
 *
 * Lamanya dihitung `panjang pesan ÷ kecepatan ketik`, lalu dijepit di antara
 * `min` dan `max`. Dengan bawaan 15 karakter/detik, 2 detik, dan 20 detik:
 * 10 karakter menjadi 2 detik, 60 karakter 4 detik, 150 karakter 10 detik,
 * dan 300 karakter ke atas berhenti di 20 detik.
 *
 * Bawaannya **mati**. Selama `WHATSAPP_TYPING` tidak diisi, {@link durationFor}
 * mengembalikan null dan jalur kirim berjalan persis seperti sebelum fitur ini
 * ada.
 *
 * Bedanya dengan `Presence`: kelas itu menormalkan *permintaan* pemanggil ke
 * satu kosakata, sedangkan kelas ini yang memutuskan **berapa lama**
 * indikatornya tampil. Hasilnya diserahkan ke `Presence` untuk diterjemahkan
 * tiap gateway.
 */
export class Typing {
  /** Kecepatan ketik bawaan, dalam karakter per detik. */
  static readonly DEFAULT_SPEED = 15;

  /** Lama tampil paling singkat, dalam detik. */
  static readonly DEFAULT_MIN = 2;

  /**
   * Lama tampil paling lama, dalam detik.
   *
   * Dua puluh detik bukan angka asal: di atas 20 000 milidetik Evolution API
   * memecah satu permintaan presence menjadi beberapa bagian, jadi menjaga
   * batasnya di bawah itu membuat kelima gateway menempuh jalur yang sama.
   */
  static readonly DEFAULT_MAX = 20;

  /**
   * Batas mutlak satu indikator, dalam detik.
   *
   * Salah tulis di .env — mis. `WHATSAPP_TYPING_MAX=20000` yang dimaksudkan
   * `20` — tidak boleh menahan proses pemanggil selama berjam-jam. Batas ini
   * berlaku sama seperti `Pacing.MAX_DELAY` pada jeda antar pesan.
   */
  static readonly MAX_SECONDS = 600;

  private constructor(
    private readonly on: boolean,
    private readonly typingSpeed: number,
    private readonly shortest: number,
    private readonly longest: number,
  ) {}

  /** Typing yang tidak mengubah apa pun. */
  static off(): Typing {
    return new Typing(false, Typing.DEFAULT_SPEED, Typing.DEFAULT_MIN, Typing.DEFAULT_MAX);
  }

  /**
   * Bangun dari isi environment: `1`, `15`, `2`, `20`.
   *
   * Sama seperti `Pacing.fromConfig()`: nilai yang tidak bisa dibaca memakai
   * bawaannya, bukan mematikan fiturnya — salah tulis satu kunci tidak boleh
   * membatalkan kunci lain.
   */
  static fromConfig(
    enabled: unknown,
    speed: unknown = null,
    min: unknown = null,
    max: unknown = null,
  ): Typing {
    return Typing.build(
      Typing.parseEnabled(enabled),
      Typing.parseSpeed(speed),
      Typing.parseSeconds(min, Typing.DEFAULT_MIN),
      Typing.parseSeconds(max, Typing.DEFAULT_MAX),
    );
  }

  /**
   * Bangun dari opsi pemanggil, mis. `{ enabled: true, speed: 8, max: 30 }`.
   *
   * Menyebut kunci apa pun selain `enabled` sudah dianggap permintaan untuk
   * menyalakannya — pemanggil yang menulis `{ speed: 8 }` jelas ingin
   * indikatornya muncul, dan membiarkannya tetap mati hanya menghasilkan
   * kebingungan. Untuk mematikannya, tulis `{ enabled: false }`.
   */
  static fromArray(spec: TypingSpec): Typing {
    return Typing.off().merge(spec);
  }

  /**
   * Timpa sebagian nilai, tanpa menyentuh yang tidak disebutkan.
   *
   * Sengaja menggabung, bukan mengganti: pemanggil yang cuma ingin
   * memperlambat ketikannya tidak perlu mengulang pengaturan yang sudah ada
   * di .env.
   */
  merge(spec?: TypingSpec | null): Typing {
    if (spec === null || spec === undefined) return this;
    if (Object.keys(spec).length === 0) return this;

    return Typing.build(
      hasKey(spec, 'enabled') ? Typing.parseEnabled(spec.enabled) : true,
      hasKey(spec, 'speed') ? Typing.parseSpeed(spec.speed) : this.typingSpeed,
      hasKey(spec, 'min') ? Typing.parseSeconds(spec.min, Typing.DEFAULT_MIN) : this.shortest,
      hasKey(spec, 'max') ? Typing.parseSeconds(spec.max, Typing.DEFAULT_MAX) : this.longest,
    );
  }

  /** Apakah SDK memunculkan indikator sendiri sebelum mengirim. */
  isEnabled(): boolean {
    return this.on;
  }

  /**
   * Lama indikator ditampilkan untuk pesan sepanjang `length` karakter.
   *
   * `length` dihitung dalam **karakter**, bukan byte — lihat `Text.length()`,
   * sama seperti ambang pesan panjang milik pacing.
   *
   * Null berarti "tidak ada indikator", dan pemanggil yang memutuskan
   * berikutnya. Nol berarti "indikator aktif, tapi pesan ini tidak perlu
   * ditunggu" — dua hal yang berbeda, jadi keduanya tidak boleh disamakan.
   */
  durationFor(length: number): number | null {
    if (!this.on) return null;

    // Pesan kosong tidak sedang "diketik" oleh siapa pun.
    if (length <= 0) return 0;

    return Math.max(this.shortest, Math.min(this.longest, Math.ceil(length / this.typingSpeed)));
  }

  /** Kecepatan ketik, karakter per detik. */
  speed(): number {
    return this.typingSpeed;
  }

  /** Lama tampil paling singkat, detik. */
  min(): number {
    return this.shortest;
  }

  /** Lama tampil paling lama, detik. */
  max(): number {
    return this.longest;
  }

  /** Susun objek sekaligus rapikan batasnya, supaya `min` tidak melewati `max`. */
  private static build(enabled: boolean, speed: number, min: number, max: number): Typing {
    return new Typing(enabled, speed, Math.min(min, max), Math.max(min, max));
  }

  /** Baca saklar on/off; apa pun yang tidak dikenali berarti mati. */
  private static parseEnabled(value: unknown): boolean {
    return validateBoolean(value);
  }

  /** Kecepatan ketik; nilai tak terbaca atau nol kembali ke bawaan. */
  private static parseSpeed(value: unknown): number {
    const text = trimmedScalar(value);

    return isNumeric(text) ? Math.max(1, toInt(text)) : Typing.DEFAULT_SPEED;
  }

  /** Batas lama tampil dalam detik; nilai tak terbaca kembali ke bawaan. */
  private static parseSeconds(value: unknown, fallback: number): number {
    const text = trimmedScalar(value);

    return isNumeric(text) ? Math.min(Typing.MAX_SECONDS, Math.max(0, toInt(text))) : fallback;
  }
}
