import { ConfigurationException } from '../../exceptions';
import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { APIME_NAME } from './constants';

/**
 * Instance ApiMe — menyusun payload `POST /api/instances` dan menormalkan
 * balasan menjadi {@link Session}.
 *
 * Istilah ApiMe untuk "sesi" adalah *instance*. Perlu diingat: membuat
 * instance menuntut token **user** (JWT) atau API token, sedangkan token
 * ber-scope instance ditolak dengan HTTP 403 — lihat catatan di `ApiMe`.
 * Memeriksa instance cukup dengan token instance itu sendiri.
 *
 * ApiMe tidak memakai amplop yang seragam antar endpoint, jadi field-nya
 * dibaca dengan beberapa kemungkinan nama sekaligus. Memaku satu nama akan
 * membuat SDK ini rusak diam-diam begitu ApiMe menggantinya.
 */
export class ApiMeSession {
  /** Nilai `status`/`state` ApiMe yang berarti sesi siap dipakai. */
  private static readonly CONNECTED_STATES = ['connected', 'open', 'online', 'ready'];

  /**
   * Payload untuk `POST /api/instances`.
   *
   * @param options     Kunci yang dikenali: `name`, `webhook_url`, `webhook_secret`.
   * @param defaultName Dipakai kalau `name` tidak diberikan — biasanya dari
   *                    `WHATSAPP_INSTANCE`.
   */
  static payload(
    options: Record<string, unknown>,
    defaultName = '',
  ): Record<string, unknown> {
    const name = Text.first(options['name'] ?? null, defaultName);

    // Nama instance bukan hiasan di ApiMe: ia yang mengidentifikasi instance
    // di seluruh endpoint, jadi permintaan tanpa nama pasti gagal. Menolaknya
    // di sini memberi pesan yang menyebut kunci `.env`-nya, bukan HTTP 400
    // yang tidak menjelaskan apa-apa.
    if (name === '') {
      throw new ConfigurationException(
        'ApiMe membutuhkan nama instance: isi WHATSAPP_INSTANCE atau kirim ' +
          "{ name: '...' }",
      );
    }

    const payload: Record<string, unknown> = { name };

    for (const key of ['webhook_url', 'webhook_secret']) {
      const value = Text.of(options[key] ?? null);

      if (value !== '') {
        payload[key] = value;
      }
    }

    return payload;
  }

  /**
   * Terima balasan `POST /api/instances` maupun `GET /api/instances/{id}`.
   */
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const data = Envelope.unwrap(body);
    const status = Text.first(data['status'] ?? null, data['state'] ?? null);

    return new Session({
      provider: APIME_NAME,
      id: Text.first(data['id'] ?? null, data['instance_id'] ?? null, fallbackId),
      status,
      // Dua sinyal yang berbeda: `connected` eksplisit dari gateway, atau
      // status yang memang berarti siap. Keduanya diterima karena tidak semua
      // versi ApiMe mengirim `connected`.
      connected:
        (data['connected'] ?? null) === true ||
        Text.equalsAny(status, ...ApiMeSession.CONNECTED_STATES),
      qr: Qr.dataUri(Text.of(data['qr'] ?? null)),
      phoneNumber: Text.first(
        data['phone_number'] ?? null,
        data['phoneNumber'] ?? null,
        data['jid'] ?? null,
      ),
      profileName: Text.first(data['profile_name'] ?? null, data['profileName'] ?? null),
      raw: body,
    });
  }
}
