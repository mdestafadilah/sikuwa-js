import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { WUZAPI_NAME } from './constants';

/**
 * QR sesi wuzapi — menormalkan balasan `GET /session/qr`.
 *
 * Balasannya `{"code":200,"success":true,"data":{"QRCode":"data:image/png;base64,…",
 * "passkeyPending":false,"publicKey":null}}`. Nama field `QRCode` ditulis persis
 * seperti di handler wuzapi; sebagian versi mengembalikannya di akar body tanpa
 * amplop `data`, jadi keduanya dibaca.
 *
 * wuzapi hanya mengeluarkan QR saat sesinya tersambung ke server WhatsApp tetapi
 * belum login. Ketiga penolakannya — `no session`, `not connected`, dan
 * `already logged in` — dibedakan di `Wuzapi.showQr()`.
 */
export class WuzapiShowQr {
  static fromResponse(body: JsonObject): Session {
    const data = Envelope.data(body);
    const qr = Text.first(
      data['QRCode'] ?? null,
      data['qrcode'] ?? null,
      body['QRCode'] ?? null,
    );

    return new Session({
      provider: WUZAPI_NAME,
      id: Text.of(data['jid'] ?? null),
      status: qr !== '' ? 'qr_ready' : '',
      // Endpoint ini hanya menjawab kalau sesinya belum login, jadi hasilnya
      // tidak pernah berarti "sudah siap mengirim". Menandainya connected di
      // sini akan membuat pemanggil melewati `checkSession()` yang justru
      // satu-satunya cara tahu keadaan sebenarnya.
      connected: false,
      qr: Qr.dataUri(qr),
      raw: body,
    });
  }

  /** Sesi sudah login, jadi memang tidak ada QR yang perlu dipindai. */
  static alreadyLoggedIn(body: JsonObject): Session {
    return new Session({
      provider: WUZAPI_NAME,
      status: 'connected',
      connected: true,
      raw: body,
    });
  }

  /** Apakah amplop penolakan wuzapi berarti "sudah login". */
  static isAlreadyLoggedIn(body: JsonObject): boolean {
    const reason = Text.first(body['error'] ?? null, body['reason'] ?? null).toLowerCase();

    return reason.includes('already logged in');
  }
}
