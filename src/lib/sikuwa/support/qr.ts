/**
 * Penyeragaman payload QR antar gateway.
 *
 * Gateway tidak sepakat soal bentuk QR: Fonnte mengirim base64 telanjang,
 * OpenWA dan wuzapi mengirim data URI yang sudah lengkap, Evolution API
 * mengirim base64 di field `base64`. Pemanggil selalu menginginkan hal yang
 * sama — sesuatu yang bisa langsung dipasang di atribut `src` — jadi
 * perbedaannya dirapikan di sini, sekali, bukan di tiap provider.
 *
 * {@link dataUri} sengaja idempoten: payload yang sudah berupa data URI
 * dikembalikan apa adanya. Karena itu aman dipanggil berkali-kali, dan tidak
 * pernah menghasilkan `data:image/png;base64,data:image/png;base64,...`.
 */
export class Qr {
  /** Jenis gambar yang dipakai semua gateway di SDK ini. */
  static readonly MIME = 'image/png';

  /** Penanda awal bagian base64 pada sebuah data URI. */
  private static readonly MARKER = 'base64,';

  /**
   * Ubah payload QR apa pun menjadi data URI siap pakai.
   *
   * @param payload base64 telanjang, atau data URI yang sudah lengkap
   * @param mime    Dipakai hanya kalau payload belum berupa data URI
   */
  static dataUri(payload: string, mime: string = Qr.MIME): string {
    const trimmed = payload.trim();

    if (trimmed === '') return '';

    // Sudah data URI (OpenWA, wuzapi) — jangan dibungkus dua kali.
    if (trimmed.startsWith('data:')) return trimmed;

    return `data:${mime};${Qr.MARKER}${trimmed}`;
  }

  /**
   * Ambil base64 murni dari payload QR.
   *
   * Dipakai pemanggil yang tidak menginginkan data URI — mis. menyimpan
   * gambarnya sendiri, atau mengirimkannya sebagai JSON ke klien lain.
   */
  static base64(qr: string): string {
    const marker = qr.indexOf(Qr.MARKER);

    return marker === -1 ? qr : qr.slice(marker + Qr.MARKER.length);
  }
}
