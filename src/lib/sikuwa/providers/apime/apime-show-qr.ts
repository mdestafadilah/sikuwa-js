import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { APIME_NAME } from './constants';

/**
 * Kemungkinan nama field payload QR, dari yang paling mungkin.
 *
 * Ditaruh di tingkat modul, bukan sebagai `static` privat kelasnya: di PHP
 * konstanta kelas bisa dibaca dari method statis mana pun, sedangkan di
 * JavaScript `private static` hanya terjangkau dari dalam kelas — dan fungsi
 * pembantu di bawah memang sengaja berada di luar kelas supaya tidak ikut
 * menjadi bagian dari permukaan API-nya.
 */
const QR_FIELDS = ['qr', 'qrcode', 'qrCode', 'base64', 'image'];

/**
 * QR instance ApiMe — menormalkan balasan `GET /api/instances/{id}/qr`.
 *
 * OpenAPI ApiMe menyebut balasan endpoint ini hanya sebagai "QR code base64",
 * tanpa mendefinisikan skemanya sama sekali. Karena itu pembacaannya sengaja
 * longgar: beberapa kemungkinan nama field dicoba, dan `data` yang berupa
 * string dianggap langsung sebagai payload QR-nya. Memaku satu bentuk tertentu
 * akan membuat SDK ini rusak diam-diam begitu ApiMe mengganti namanya.
 */
export class ApiMeShowQr {
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const data = Envelope.unwrap(body);

    return new Session({
      provider: APIME_NAME,
      id: Text.first(data['id'] ?? null, data['instance_id'] ?? null, fallbackId),
      status: Text.first(data['status'] ?? null, data['state'] ?? null),
      // Endpoint ini hanya menjawab selama instance belum tersambung, jadi
      // hasilnya tidak pernah berarti "siap mengirim".
      connected: false,
      qr: Qr.dataUri(qrPayload(body, data)),
      raw: body,
    });
  }
}

/**
 * Cari payload QR di antara beberapa kemungkinan bentuk balasan.
 *
 * @param body Amplop lengkap, untuk kasus `data` berupa string.
 * @param data Isi `data` bila memang berupa objek.
 */
function qrPayload(body: JsonObject, data: JsonObject): string {
  for (const field of QR_FIELDS) {
    const value = Text.of(data[field] ?? null);

    if (value !== '') {
      return value;
    }
  }

  // Sebagian versi menaruh base64-nya langsung di `data`, bukan di dalamnya.
  // `Envelope.unwrap` mengembalikan body apa adanya saat `data` bukan objek,
  // jadi di sini `body['data']` masih berisi string itu.
  return Text.of(body['data'] ?? null);
}
