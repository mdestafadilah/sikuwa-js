import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { OPENWA_NAME } from './constants';

/**
 * QR sesi OpenWA — menormalkan balasan `GET /api/sessions/{id}/qr`.
 *
 * Balasannya `{"qrCode": "data:image/png;base64,…", "status": "qr_ready"}`.
 * Sebagian versi membungkusnya sebagai `{success, data}` dan menamai fieldnya
 * `qr`, jadi keduanya diterima — seperti di `OpenWASession`.
 *
 * Perlu diperhatikan: `status` di sini **bukan** status sesi, melainkan
 * kesiapan QR-nya. Endpoint ini hanya menjawab saat sesi memang sedang menunggu
 * dipindai; sesi yang sudah tersambung ditolak dengan HTTP 400, dan API key
 * yang bukan kunci berperan operator ditolak dengan HTTP 403. Karena satu
 * status dipakai untuk beberapa sebab sekaligus, pesan dari gateway sendiri
 * yang paling menentukan — dan itulah yang diteruskan `reject()`.
 */
export class OpenWAShowQr {
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const data = Envelope.unwrap(body);

    return new Session({
      provider: OPENWA_NAME,
      id: Text.first(data['id'] ?? null, fallbackId),
      status: Text.of(data['status'] ?? null).toUpperCase(),
      // Endpoint ini hanya menjawab kalau sesinya belum tersambung, jadi
      // hasilnya tidak pernah berarti "sudah siap mengirim". Menandainya
      // connected di sini akan membuat pemanggil melewati `checkSession()`
      // yang justru satu-satunya cara tahu keadaan sebenarnya.
      connected: false,
      qr: Qr.dataUri(Text.first(data['qrCode'] ?? null, data['qr'] ?? null)),
      raw: body,
    });
  }
}
