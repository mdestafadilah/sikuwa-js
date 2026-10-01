/** Amplop JSON apa adanya dari gateway. */
export type JsonObject = Record<string, unknown>;

/**
 * Pembukaan amplop JSON gateway.
 *
 * Sebagian gateway membungkus datanya di dalam kunci `data`, sebagian lagi
 * mengirim objeknya langsung di akar body — dan beberapa di antaranya
 * mengganti-ganti perilaku itu antar versi. Dua penolong di sini menyatukan
 * perbedaan itu, supaya tiap penormal sesi tidak menulis ulang pemeriksaan
 * yang sama.
 *
 * Bedanya cuma soal isi cadangan: {@link unwrap} memakai body apa adanya,
 * {@link data} memakai objek kosong.
 */
export class Envelope {
  /**
   * Isi `data`; kalau `data` tidak ada atau bukan objek, body dikembalikan
   * apa adanya.
   *
   * Dipakai gateway yang sebagian versinya mengirim objeknya langsung di akar
   * body — OpenWA dan ApiMe.
   */
  static unwrap(body: JsonObject): JsonObject {
    const data = body['data'];

    return isPlainObject(data) ? data : body;
  }

  /**
   * Isi `data`; kalau `data` tidak ada atau bukan objek, objek kosong.
   *
   * Dipakai gateway yang seluruh datanya memang selalu ada di `data` —
   * wuzapi.
   */
  static data(body: JsonObject): JsonObject {
    const data = body['data'];

    return isPlainObject(data) ? data : {};
  }
}

/** `is_array()` PHP: objek JSON biasa, bukan null maupun daftar. */
export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
