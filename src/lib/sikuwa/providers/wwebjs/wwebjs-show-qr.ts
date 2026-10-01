import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Text } from '../../support/text';
import { WWEBJS_NAME } from './constants';
import { WwebjsSession } from './wwebjs-session';

/** Sebutan wwebjs saat QR-nya sudah dipindai. */
const ALREADY_SCANNED = 'already scanned';

/** Byte kosong, dipakai ulang supaya `fromImage(null)` tidak mengalokasi. */
const EMPTY = new Uint8Array(0);

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
   * @param png Byte PNG apa adanya dari `HttpResponse.bytes` — **bukan**
   *            `HttpResponse.body`. `body` sudah melewati decoder UTF-8, dan
   *            byte di luar UTF-8 (mis. `0x89` di header PNG) menjadi U+FFFD
   *            sebelum sempat di-base64. Null dan byte kosong sama-sama
   *            menghasilkan data URI kosong, seperti `base64_encode('')` PHP.
   */
  static fromImage(png: Uint8Array | null, sessionId: string): Session {
    return new Session({
      provider: WWEBJS_NAME,
      id: sessionId,
      status: 'qr_ready',
      connected: false,
      qr: 'data:image/png;base64,' + base64Encode(png ?? EMPTY),
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
 * `base64_encode()` PHP, untuk byte mentah.
 *
 * Menerima byte, bukan teks, karena itulah yang sesungguhnya dikirim server —
 * dan itulah yang di-base64 oleh `base64_encode($response->body)` di PHP, sebab
 * `$response->body` Guzzle juga byte mentah. Isi PNG tidak bisa dilewatkan
 * sebagai teks: header-nya memuat `0x89`, yang di luar UTF-8, sehingga versi
 * teks dari fungsi ini akan mengubah byte pertama setiap QR menjadi U+FFFD dan
 * menghasilkan gambar yang tidak bisa dibuka.
 *
 * `btoa` dijalankan atas satu string biner karena `String.fromCharCode` hanya
 * menerima satu argumen per byte. QR PNG besarnya beberapa kilobyte, jadi
 * perulangan sederhana ini cukup; kalau suatu saat ada body besar yang lewat
 * sini, penggabungan per blok lebih tepat.
 */
function base64Encode(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
