import { ConfigurationException } from '../../exceptions';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Text } from '../../support/text';
import { WWEBJS_NAME } from './constants';

/**
 * Session wwebjs — menyusun payload `POST /session/start/{sessionId}` dan
 * menormalkan balasan `GET /session/status/{sessionId}` menjadi {@link Session}.
 *
 * Istilah wwebjs untuk "sesi" adalah *session*, dan namanya ditentukan
 * pemanggil — bukan diterbitkan server. Karena itu nama session masuk akal
 * dibaca dari `WHATSAPP_SESSION` seperti OpenWA, dan nama itulah yang muncul di
 * seluruh URL.
 */
export class WwebjsSession {
  /**
   * Nilai `state` yang berarti sesi siap mengirim pesan. Diambil dari
   * `Client.getState()` whatsapp-web.js; nilai lain (`TIMEOUT`, `CONFLICT`,
   * `UNPAIRED`, …) berarti belum siap.
   */
  static readonly CONNECTED = 'CONNECTED';

  /**
   * Nama session dari opsi pemanggil, atau dari konfigurasi.
   *
   * Middleware wwebjs-api menolak nama di luar `[A-Za-z0-9_-]` dengan HTTP
   * 422, jadi ditolak di sini dengan pesan yang menyebut aturannya —
   * bukan meneruskan 422 yang harus ditebak.
   *
   * @param options     Kunci yang dikenali: `id` (alias `name`)
   * @param defaultName Dipakai kalau `id` tidak diberikan — biasanya dari
   *                    `WHATSAPP_SESSION`
   */
  static name(options: Record<string, unknown>, defaultName = ''): string {
    const name = Text.first(options['id'] ?? null, options['name'] ?? null, defaultName);

    if (name === '') {
      throw new ConfigurationException(
        'Wwebjs membutuhkan nama session: isi WHATSAPP_SESSION atau kirim ' +
          "['id' => ...]",
      );
    }

    // `\w` di JavaScript sama dengan di PCRE tanpa modifier `u`:
    // `[A-Za-z0-9_]`, jadi polanya sepadan dengan milik PHP.
    if (!/^[\w-]+$/.test(name)) {
      throw new ConfigurationException(
        `Nama session Wwebjs hanya boleh huruf, angka, garis bawah, dan tanda minus, diberikan: ${name}`,
      );
    }

    return name;
  }

  /**
   * Body `POST /session/start/{sessionId}`.
   *
   * Endpoint ini menerima `webhookUrl` opsional — itu cara wwebjs mengabari
   * QR dan pesan masuk. Bila tidak diisi, webhook bawaan server
   * (`BASE_WEBHOOK_URL`) yang berlaku.
   *
   * Null bila tidak ada yang perlu dikirim, supaya body request-nya
   * benar-benar kosong — bukan `{}` yang tetap ikut terkirim.
   */
  static payload(options: Record<string, unknown>): Record<string, unknown> | null {
    const webhook = Text.of(options['webhookUrl'] ?? options['webhook_url'] ?? null);

    return webhook === '' ? null : { webhookUrl: webhook };
  }

  /**
   * Terima balasan `POST /session/start/{sessionId}`.
   *
   * Balasannya hanya `{success, message}`, tanpa keadaan sambungan: servernya
   * baru membalas setelah Chromium selesai dimuat, dan saat itu sesinya masih
   * menunggu dipindai. Karena itu `connected` selalu false di sini — keadaan
   * sebenarnya dibaca lewat `Wwebjs.checkSession()`.
   */
  static fromStart(body: JsonObject, sessionId: string): Session {
    return new Session({
      provider: WWEBJS_NAME,
      id: sessionId,
      status: (body['success'] ?? false) === true ? 'starting' : 'unknown',
      connected: false,
      raw: body,
    });
  }

  /**
   * Terima balasan `GET /session/status/{sessionId}`.
   *
   * Balasannya `{success, state, message}`, dan `state` hanya terisi saat
   * sesinya benar-benar ada. Kalau kosong, `message` yang menjelaskan
   * sebabnya (`session_not_found`, `session_not_connected`), jadi itulah yang
   * dipakai sebagai status.
   */
  static fromStatus(body: JsonObject, sessionId: string): Session {
    const state = Text.of(body['state'] ?? null);
    const message = Text.of(body['message'] ?? null);

    return new Session({
      provider: WWEBJS_NAME,
      id: sessionId,
      status: state !== '' ? state : message,
      connected: Text.equalsAny(state, WwebjsSession.CONNECTED),
      raw: body,
    });
  }
}
