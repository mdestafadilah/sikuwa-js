import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Text } from '../../support/text';
import { WWEBJS_NAME } from './constants';
import { WwebjsSession } from './wwebjs-session';

/** Sebutan wwebjs saat QR-nya sudah dipindai. */
const ALREADY_SCANNED = 'already scanned';

/**
 * QR session wwebjs — menormalkan balasan `GET /session/qr/{sessionId}/image`.
 *
 * Endpoint itu mengirim PNG biner, bukan JSON: itulah sebabnya
 * {@link fromImage} menerima isinya lalu membungkusnya menjadi data URI.
 * Balasan JSON hanya muncul saat QR-nya memang tidak ada — lihat
 * `Wwebjs.showQr()`.
 */
export class WwebjsShowQr {
  /**
   * PNG dari gateway, dibungkus menjadi data URI siap pasang.
   *
   * Base64 dilakukan di sini, bukan diserahkan pemanggil: `Session.qr`
   * berjanji selalu berupa data URI penuh.
   *
   * @param png Isi body respons apa adanya dari `HttpResponse`
   */
  static fromImage(png: string, sessionId: string): Session {
    return new Session({
      provider: WWEBJS_NAME,
      id: sessionId,
      status: 'qr_ready',
      connected: false,
      qr: 'data:image/png;base64,' + base64Encode(png),
    });
  }

  /** Sesi sudah tersambung, jadi memang tidak ada QR yang perlu dipindai. */
  static alreadyConnected(body: JsonObject, sessionId: string): Session {
    return new Session({
      provider: WWEBJS_NAME,
      id: sessionId,
      status: WwebjsSession.CONNECTED,
      connected: true,
      raw: body,
    });
  }

  /**
   * Apakah amplop penolakan wwebjs berarti "QR-nya sudah dipindai".
   *
   * wwebjs menyatukan dua sebab dalam satu kalimat — `qr code not ready or
   * already scanned` — jadi yang dibaca di sini hanya yang kedua. Sesi yang
   * masih memuat Chromium memang belum menerbitkan QR, dan itu keadaan biasa,
   * bukan kegagalan.
   */
  static isAlreadyScanned(body: JsonObject): boolean {
    return Text.of(body['message'] ?? null).toLowerCase().includes(ALREADY_SCANNED);
  }
}

/**
 * `base64_encode($png)` PHP, untuk body respons yang di sini sudah berupa teks.
 *
 * Bedanya nyata dan tidak bisa dihindari di lapisan ini: `$response->body` di
 * Guzzle adalah byte mentah, sedangkan `HttpExecutor` membaca body lewat
 * `response.text()` sehingga byte-nya sudah diterjemahkan sebagai UTF-8. Untuk
 * QR yang byte-nya sah UTF-8 hasilnya sama; untuk PNG yang memuat byte di luar
 * UTF-8 (mis. `0x89` di header PNG), byte itu sudah menjadi U+FFFD sebelum
 * sampai ke sini — jadi yang di-base64 memang teks yang diterima, bukan byte
 * asli server. Memperbaikinya menuntut `HttpExecutor` menyediakan byte mentah,
 * dan itu di luar cakupan berkas ini.
 */
function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
