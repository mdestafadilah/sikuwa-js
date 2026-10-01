import { hasKey, isNumeric, isScalar, randomInt, toInt, trimmedScalar } from '../internal/scalar';

/** Bentuk opsi `pacing` yang diterima pemanggil. */
export interface PacingSpec {
  cycle?: string | number | readonly unknown[] | null;
  interval?: string | number | readonly unknown[] | null;
  long_chars?: string | number | null;
  long_factor?: string | number | null;
}

/**
 * Pengatur jeda antar pesan saat mengirim beruntun.
 *
 * Berangkat dari satu masalah yang sama di semua gateway: jeda yang seragam
 * membuat pengiriman beruntun mudah dikenali sebagai robot. Karena itu jeda
 * disusun dari tiga bagian yang bisa dipakai sendiri-sendiri atau bersamaan:
 *
 * 1. **Siklus** — daftar jeda tetap yang dipakai bergiliran. `0, 30` berarti
 *    pesan ke-1 tanpa jeda, ke-2 jeda 30 detik, ke-3 tanpa jeda, dan
 *    seterusnya. Bagian ini yang membuat polanya tidak rata.
 * 2. **Interval acak** — jitter yang ditambahkan ke tiap jeda siklus. `20-30`
 *    berarti setiap jeda ditambah 20–30 detik acak. Bagian ini yang membuat
 *    polanya tidak bisa ditebak.
 * 3. **Pesan panjang** — pesan yang isinya panjang ditunggu lebih lama,
 *    karena mengirim teks panjang beruntun lebih mencurigakan daripada
 *    mengirim pesan pendek. Ambang dan pengalinya diatur
 *    `WHATSAPP_PACING_LONG_CHARS` dan `WHATSAPP_PACING_LONG_FACTOR`.
 *
 * Jadi jeda sebelum pesan ke-`i` adalah
 * `(siklus[i % jumlah siklus] + jitter) × pengali pesan panjang`. Dengan
 * `WHATSAPP_PACING_CYCLE=0,30`, `WHATSAPP_PACING_INTERVAL=20-30`, dan ambang
 * bawaan 300 karakter, pesan pendek berurutan 20–30, 50–60, 20–30, … detik
 * sementara pesan panjang 60–90, 150–180, 60–90, … detik.
 *
 * Bawaannya **mati**. Selama kedua kunci pertama kosong, {@link delayFor}
 * mengembalikan null dan tiap gateway memakai nilai bawaannya sendiri seperti
 * sebelumnya — perilaku lama tidak berubah hanya karena fitur ini ada.
 */
export class Pacing {
  /**
   * Batas satu jeda, dalam detik.
   *
   * Salah tulis di .env — mis. `200-300` yang dimaksudkan `20-30` — tidak
   * boleh membuat proses pemanggil menggantung berjam-jam, sama seperti
   * `Config.timeout()` yang membatasi dirinya. Batas ini berlaku setelah
   * pengali pesan panjang ikut dihitung.
   */
  static readonly MAX_DELAY = 600;

  /** Panjang pesan yang sudah dianggap "panjang", dalam karakter. */
  static readonly DEFAULT_LONG_CHARS = 300;

  /** Berapa kali jeda dilipatkan untuk pesan panjang. */
  static readonly DEFAULT_LONG_FACTOR = 3;

  private constructor(
    private readonly cycleList: readonly number[],
    private readonly minJitter: number | null,
    private readonly maxJitter: number | null,
    private readonly longCharsValue: number,
    private readonly longFactorValue: number,
  ) {}

  /** Pacing yang tidak mengubah apa pun. */
  static none(): Pacing {
    return new Pacing([], null, null, Pacing.DEFAULT_LONG_CHARS, Pacing.DEFAULT_LONG_FACTOR);
  }

  /**
   * Bangun dari isi environment: `0,30`, `20-30`, `300`, `3`.
   *
   * Nilai yang tidak bisa dibaca memakai bawaannya, bukan mematikan
   * pacing-nya — salah tulis satu kunci tidak boleh membatalkan kunci lain.
   */
  static fromConfig(
    cycle: unknown,
    interval: unknown,
    longChars: unknown = null,
    longFactor: unknown = null,
  ): Pacing {
    const [min, max] = Pacing.parseInterval(interval);

    return new Pacing(
      Pacing.parseCycle(cycle),
      min,
      max,
      Pacing.parseLongChars(longChars),
      Pacing.parseLongFactor(longFactor),
    );
  }

  /**
   * Bangun dari opsi pemanggil, mis.
   * `{ cycle: '0,30', interval: [20, 30], long_factor: 5 }`.
   */
  static fromArray(spec: PacingSpec): Pacing {
    return Pacing.none().merge(spec);
  }

  /**
   * Timpa sebagian nilai, tanpa menyentuh yang tidak disebutkan.
   *
   * Sengaja menggabung, bukan mengganti: pemanggil yang cuma ingin mengubah
   * intervalnya tidak perlu mengulang siklus yang sudah ada di .env. Untuk
   * mematikan salah satunya, sebutkan kuncinya dengan nilai null.
   */
  merge(spec?: PacingSpec | null): Pacing {
    if (spec === null || spec === undefined) return this;
    if (Object.keys(spec).length === 0) return this;

    const cycleList = hasKey(spec, 'cycle') ? Pacing.parseCycle(spec.cycle) : this.cycleList;

    const [min, max] = hasKey(spec, 'interval')
      ? Pacing.parseInterval(spec.interval)
      : ([this.minJitter, this.maxJitter] as const);

    return new Pacing(
      cycleList,
      min,
      max,
      hasKey(spec, 'long_chars') ? Pacing.parseLongChars(spec.long_chars) : this.longCharsValue,
      hasKey(spec, 'long_factor') ? Pacing.parseLongFactor(spec.long_factor) : this.longFactorValue,
    );
  }

  /** Apakah pacing ini mengubah jeda sama sekali. */
  isEnabled(): boolean {
    return this.cycleList.length > 0 || this.minJitter !== null;
  }

  /**
   * Jeda sebelum pesan ke-`index` dikirim, dalam detik.
   *
   * `length` adalah panjang isi pesan dalam **karakter** — lihat
   * `Text.length()`. Pesan yang panjang ditunggu `longFactor` kali lebih lama,
   * karena itulah bagian yang membuat jedanya terasa wajar.
   *
   * Null berarti "tidak ada pacing", dan pemanggil yang memutuskan nilai
   * penggantinya — bawaan gateway atau nol. Nol berarti "pacing aktif, dan
   * untuk pesan ini jedanya nol" — dua hal yang berbeda, jadi keduanya tidak
   * boleh disamakan.
   */
  delayFor(index: number, length = 0): number | null {
    if (!this.isEnabled()) return null;

    const base =
      this.cycleList.length === 0 ? 0 : (this.cycleList[index % this.cycleList.length] as number);
    const jitter =
      this.minJitter === null ? 0 : randomInt(this.minJitter, this.maxJitter as number);
    const delay = (base + jitter) * (this.isLong(length) ? this.longFactorValue : 1);

    return Math.min(Pacing.MAX_DELAY, delay);
  }

  /** Apakah pesan sepanjang `length` karakter diperlakukan sebagai panjang. */
  isLong(length: number): boolean {
    return this.longCharsValue > 0 && length >= this.longCharsValue;
  }

  /** Siklus jeda apa adanya, detik. */
  cycle(): number[] {
    return [...this.cycleList];
  }

  interval(): { min: number; max: number } | null {
    return this.minJitter === null
      ? null
      : { min: this.minJitter, max: this.maxJitter as number };
  }

  /** Ambang pesan panjang, karakter. 0 berarti aturannya dimatikan. */
  longChars(): number {
    return this.longCharsValue;
  }

  /** Pengali jeda untuk pesan panjang. 1 berarti tidak ada pengalian. */
  longFactor(): number {
    return this.longFactorValue;
  }

  /**
   * Siklus jeda dari teks `0, 30` maupun array `[0, 30]`.
   *
   * Bagian yang bukan angka dilewati, bukan ditolak: salah tulis di .env
   * tidak boleh membuat pengiriman gagal total — sama seperti
   * `WHATSAPP_TIMEOUT` yang mengabaikan nilai di luar rentang.
   */
  private static parseCycle(value: unknown): number[] {
    const parts = Array.isArray(value)
      ? value
      : (isScalar(value) ? String(value) : '').split(',');

    const cycleList: number[] = [];

    for (const part of parts) {
      if (!isScalar(part)) continue;

      const text = String(part).trim();

      if (text === '' || !isNumeric(text)) continue;

      cycleList.push(Math.min(Pacing.MAX_DELAY, Math.max(0, toInt(text))));
    }

    return cycleList;
  }

  /**
   * Interval acak dari teks `20-30`, angka tunggal `25`, atau array `[20, 30]`.
   *
   * Urutan terbalik (`30-20`) dibetulkan alih-alih ditolak, karena maksudnya
   * sudah jelas dan menolaknya hanya memindahkan pekerjaan ke pemanggil.
   */
  private static parseInterval(value: unknown): [number | null, number | null] {
    if (Array.isArray(value)) {
      const parts = [...value];

      return Pacing.clampRange(
        parts[0] !== undefined && isNumeric(parts[0]) ? toInt(parts[0]) : null,
        parts[1] !== undefined && isNumeric(parts[1]) ? toInt(parts[1]) : null,
      );
    }

    const text = trimmedScalar(value);

    if (text === '') return [null, null];

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(text);

    if (range !== null) {
      return Pacing.clampRange(Number(range[1]), Number(range[2]));
    }

    return isNumeric(text) ? Pacing.clampRange(toInt(text), null) : [null, null];
  }

  /**
   * Rapikan sepasang batas: null bila tidak ada, urut, dan di dalam rentang.
   */
  private static clampRange(low: number | null, high: number | null): [number | null, number | null] {
    if (low === null) return [null, null];

    let lo = low;
    let hi = high ?? low;

    if (lo > hi) [lo, hi] = [hi, lo];

    return [
      Math.min(Pacing.MAX_DELAY, Math.max(0, lo)),
      Math.min(Pacing.MAX_DELAY, Math.max(0, hi)),
    ];
  }

  /** Ambang pesan panjang; nilai tak terbaca kembali ke bawaan. */
  private static parseLongChars(value: unknown): number {
    const text = trimmedScalar(value);

    return isNumeric(text) ? Math.max(0, toInt(text)) : Pacing.DEFAULT_LONG_CHARS;
  }

  /** Pengali pesan panjang; 1 berarti tidak mengalikan apa pun. */
  private static parseLongFactor(value: unknown): number {
    const text = trimmedScalar(value);

    return isNumeric(text) ? Math.max(1, toInt(text)) : Pacing.DEFAULT_LONG_FACTOR;
  }
}
