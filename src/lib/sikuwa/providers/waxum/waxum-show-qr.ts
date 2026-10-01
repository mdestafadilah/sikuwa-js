import { isArrayLike } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { WAXUM_NAME } from './constants';

/**
 * QR sesi Waxum — menormalkan balasan `GET /sessions/{id}/qr`.
 *
 * Balasannya `{"qr_codes":["2@ABC…"],"timeout_seconds":60,"status":"waiting_for_qr"}`.
 * Perhatikan bahwa `qr_codes` adalah **daftar**, bukan satu nilai: Waxum
 * mengganti kodenya berkala, dan yang dikirim adalah yang terbaru. Yang dipakai
 * SDK adalah elemen pertama — daftar itu diurutkan dari yang paling baru.
 *
 * Isi tiap elemen bukan base64, melainkan string mentah yang harus digambar
 * menjadi QR oleh pemanggil. Karena `Session.qr` dijanjikan selalu data URI,
 * string itu dibiarkan kosong kecuali kalau ia memang sudah berupa gambar
 * (base64 PNG atau data URI) — daripada memasang data URI yang isinya bukan
 * PNG dan menghasilkan `<img>` yang rusak. Bentuk mentahnya tetap bisa dibaca
 * lewat `Session.raw`.
 */
export class WaxumShowQr {
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const first = Text.of(firstCode(body['qr_codes']));

    return new Session({
      provider: WAXUM_NAME,
      id: Text.first(body['id'] ?? null, fallbackId),
      status: Text.of(body['status'] ?? null),
      connected: false,
      qr: WaxumShowQr.dataUri(first),
      raw: body,
    });
  }

  /**
   * Sesi yang sudah login tidak punya QR untuk dipindai.
   *
   * Dipakai provider saat `qr_codes` kosong: keadaan sesi pada balasan yang
   * sama menentukan apakah itu berarti "sudah selesai" atau "belum siap".
   * Karena itu `status` sengaja diteruskan apa adanya, bukan diubah menjadi
   * `logged_in` — yang memutuskan hanya Waxum.
   */
  static alreadyConnected(body: JsonObject, fallbackId = ''): Session {
    return new Session({
      provider: WAXUM_NAME,
      id: Text.first(body['id'] ?? null, fallbackId),
      status: Text.of(body['status'] ?? null),
      connected: true,
      raw: body,
    });
  }

  /**
   * Apakah payload QR ini benar-benar gambar yang bisa dipasang di `src`.
   *
   * Waxum mengirim string mentah untuk digambar sendiri, dan itu bukan gambar.
   * Memasukkannya ke data URI PNG akan menghasilkan gambar rusak yang lebih
   * membingungkan daripada QR yang kosong.
   */
  private static dataUri(payload: string): string {
    if (payload === '') {
      return '';
    }

    if (payload.startsWith('data:')) {
      return Qr.dataUri(payload);
    }

    // Base64 PNG yang sah selalu dimulai dengan tanda tangan berkas PNG
    // setelah di-decode ("\x89PNG"), yaitu "iVBOR" dalam bentuk base64.
    return payload.startsWith('iVBOR') ? Qr.dataUri(payload) : '';
  }
}

/**
 * `$codes[0] ?? null` PHP dari balasan `qr_codes`.
 *
 * `json_decode(…, true)` mengubah objek JSON menjadi array asosiatif, jadi
 * `{"0":"…"}` dan `["…"]` sama-sama menghasilkan elemen pertama yang sama.
 * Keduanya diterima di sini supaya tidak berbeda dari versi PHP.
 */
function firstCode(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? null;
  if (isArrayLike(value)) return value['0'] ?? null;

  return null;
}
