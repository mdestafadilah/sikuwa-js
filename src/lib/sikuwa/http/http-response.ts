import { isPlainObject, type JsonObject } from '../support/envelope';
import { isNumeric, toInt } from '../internal/scalar';

/** Body JSON yang sudah di-decode: objek atau daftar. */
export type JsonBody = JsonObject | unknown[];

/**
 * Hasil satu request HTTP.
 *
 * `error` hanya terisi bila request gagal di level transport — DNS, timeout,
 * TLS. Respons HTTP 4xx/5xx tetap dianggap "sampai", jadi `error` kosong dan
 * statusnya ada di `status`. Pemisahan ini disengaja: penolakan dari gateway
 * perlu diurai per gateway (amplop errornya berbeda-beda), sedangkan kegagalan
 * transport tidak.
 *
 * `retryAfter` adalah nilai mentah header `Retry-After` bila ada; pakai
 * {@link retryAfterSeconds} untuk membacanya sebagai detik.
 */
export class HttpResponse {
  constructor(
    readonly status: number,
    readonly body: string | null,
    readonly error = '',
    readonly timedOut = false,
    readonly retryAfter: string | null = null,
    /**
     * Byte mentah body, sebelum diterjemahkan sebagai UTF-8.
     *
     * `body` sengaja tetap ada dan tetap yang dipakai hampir semua provider:
     * tujuh gateway di sini berbicara JSON, dan memaksa mereka mengurai byte
     * sendiri hanya akan menambah kerja yang sama di tujuh tempat.
     *
     * Field ini ada karena **satu** endpoint memang mengirim biner: QR Wwebjs
     * mengirim PNG. Di PHP, `$response->body` Guzzle adalah byte mentah,
     * sehingga `base64_encode()` di sana mengubah byte yang sebenarnya.
     * Padanannya di sini tidak bisa memakai `body` — `response.text()` sudah
     * mengganti setiap byte di luar UTF-8 (mis. `0x89` di header PNG) menjadi
     * U+FFFD, dan byte yang sudah hilang tidak bisa dikembalikan. Jadi yang
     * benar-benar diterima server disimpan di sini apa adanya.
     *
     * Null bila request gagal di level transport, atau bila body-nya kosong.
     */
    readonly bytes: Uint8Array | null = null,
  ) {}

  isSuccess(): boolean {
    return this.error === '' && this.status >= 200 && this.status < 300;
  }

  /**
   * Berapa detik pemanggil sebaiknya menunggu sebelum mencoba lagi.
   *
   * Header `Retry-After` datang dalam dua bentuk, dan keduanya diurus di sini
   * supaya provider tidak perlu tahu bedanya:
   *
   * - **detik** (`Retry-After: 30`) — dikembalikan apa adanya;
   * - **tanggal HTTP** (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) —
   *   dikurangi waktu sekarang, karena selisih itulah yang berguna.
   *
   * Null bila headernya tidak ada, tidak terbaca, atau sudah lewat. Nol
   * dikembalikan sebagai null juga: menunggu nol detik sama saja dengan tidak
   * menunggu, dan pemanggil yang memperlakukannya sebagai "coba langsung" akan
   * menabrak dinding yang sama.
   */
  retryAfterSeconds(): number | null {
    if (this.retryAfter === null) return null;

    const text = this.retryAfter.trim();

    if (text === '') return null;

    if (isNumeric(text)) {
      const seconds = toInt(text);

      return seconds > 0 ? seconds : null;
    }

    // Bentuk tanggal: apa pun yang tidak bisa diurai dianggap tidak ada, bukan
    // dilempar sebagai error — header rusak bukan alasan menggagalkan
    // pengiriman yang mungkin masih bisa diselamatkan.
    const parsed = Date.parse(text);

    if (Number.isNaN(parsed)) return null;

    const seconds = Math.floor(parsed / 1000) - Math.floor(Date.now() / 1000);

    return seconds > 0 ? seconds : null;
  }

  /**
   * Decode body sebagai array. Mengembalikan null kalau body kosong atau bukan
   * JSON objek/daftar yang valid.
   */
  json(): JsonBody | null {
    if (this.body === null || this.body === '') return null;

    let decoded: unknown;

    try {
      decoded = JSON.parse(this.body);
    } catch {
      return null;
    }

    return isPlainObject(decoded) || Array.isArray(decoded) ? decoded : null;
  }
}
