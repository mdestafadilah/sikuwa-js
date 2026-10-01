import { isArrayLike } from '../../internal/scalar';
import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { OPENWA_NAME } from './constants';

/**
 * Sesi OpenWA — menyusun payload `POST /api/sessions` dan menormalkan balasan
 * gateway menjadi {@link Session} yang seragam.
 *
 * Status yang dipakai OpenWA: `CONNECTED`, `DISCONNECTED`, `INITIALIZING`.
 * Sesi yang baru dibuat selalu `INITIALIZING`, jadi belum bisa dipakai kirim —
 * ambil QR-nya dulu lewat `showQr()`, lalu pantau dengan `checkSession()`.
 */
export class OpenWASession {
  static readonly CONNECTED = 'CONNECTED';

  /**
   * Payload untuk `POST /api/sessions`.
   *
   * @param options   Kunci yang dikenali: `id`, `name`, `config`.
   * @param defaultId Dipakai kalau `id` tidak diberikan — biasanya dari
   *                  `WHATSAPP_SESSION`.
   */
  static payload(options: Record<string, unknown>, defaultId = ''): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    const id = Text.first(options['id'] ?? null, defaultId);

    if (id !== '') {
      payload['id'] = id;
    }

    const name = Text.of(options['name'] ?? null);

    if (name !== '') {
      payload['name'] = name;
    }

    // `config` diteruskan apa adanya: kuncinya milik OpenWA
    // (autoReconnect, webhookUrl, proxy) dan bisa bertambah antar versi.
    // Jadi ia sengaja tidak disalin per kunci.
    const config = options['config'] ?? null;

    if (isArrayLike(config) && Object.keys(config).length > 0) {
      payload['config'] = config;
    }

    return payload;
  }

  /**
   * Terima balasan `POST /api/sessions` maupun `GET /api/sessions/{id}`.
   *
   * Sebagian versi membungkus objeknya sebagai `{ success, data }`, sebagian
   * lagi mengirimnya langsung di akar body — {@link Envelope.unwrap} menerima
   * keduanya.
   */
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const data = Envelope.unwrap(body);
    const status = Text.of(data['status'] ?? null).toUpperCase();

    return new Session({
      provider: OPENWA_NAME,
      id: Text.first(data['id'] ?? null, fallbackId),
      status,
      connected: status === OpenWASession.CONNECTED,
      qr: Qr.dataUri(Text.of(data['qr'] ?? null)),
      phoneNumber: Text.of(data['phoneNumber'] ?? null),
      // Sebagian versi menamai nama profil `pushName`, sebagian `profileName`.
      profileName: Text.first(data['profileName'] ?? null, data['pushName'] ?? null),
      raw: body,
    });
  }
}
