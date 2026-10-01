import { isArrayLike, toPhpBool } from '../../internal/scalar';
import { Session } from '../../session';
import { Envelope, type JsonObject } from '../../support/envelope';
import { Text } from '../../support/text';
import { WUZAPI_NAME } from './constants';

/**
 * Sesi wuzapi — menyusun payload `POST /session/connect` dan menormalkan
 * balasan menjadi {@link Session}.
 *
 * wuzapi tidak mengenal id sesi: token-nya sendiri yang menentukan sesi mana
 * yang dipakai. Karena itu `createSession()` di sini berarti *menyambungkan*
 * sesi (setara tombol "connect" di dashboard), bukan mendaftarkan yang baru —
 * pendaftaran user/sesi adalah urusan endpoint `/admin`, di luar SDK ini.
 *
 * Dua endpoint sesi memakai amplop `data` yang berbeda isinya, jadi keduanya
 * punya penormal sendiri: {@link fromConnect} untuk balasan `/session/connect`,
 * dan {@link fromStatus} untuk `/session/status`.
 */
export class WuzapiSession {
  /** Jenis event yang dilanggankan bila pemanggil tidak memilih. */
  static readonly DEFAULT_EVENTS: string[] = ['Message'];

  /**
   * Payload untuk `POST /session/connect`.
   *
   * @param options Kunci yang dikenali: `subscribe` (list event), `immediate` (bool).
   */
  static payload(options: Record<string, unknown>): Record<string, unknown> {
    const raw = options['subscribe'] ?? null;

    // `isArrayLike` mencakup daftar maupun peta berkunci teks, sama seperti
    // `is_array()` PHP; daftar yang kosong sama saja dengan tidak diisi.
    const events: unknown[] =
      isArrayLike(raw) && Object.keys(raw).length > 0
        ? Object.values(raw)
        : WuzapiSession.DEFAULT_EVENTS;

    return {
      Subscribe: events.map((event) => Text.of(event)),
      // Bawaannya Immediate, supaya pemanggil tidak tertahan ~10 detik
      // menunggu wuzapi memverifikasi login. Keadaan sebenarnya dibaca
      // lewat checkSession().
      //
      // Cast-nya gaya PHP, bukan `Boolean()` JavaScript: `'0'` dan `''`
      // berarti salah, sedangkan `'false'` justru benar.
      Immediate: toPhpBool(options['immediate'] ?? true),
    };
  }

  /** Terima balasan `POST /session/connect`. */
  static fromConnect(body: JsonObject): Session {
    const data = Envelope.data(body);
    const connected = body['success'] === true;

    return new Session({
      provider: WUZAPI_NAME,
      // wuzapi tidak punya id sesi; JID inilah identitas sesi yang tersambung.
      id: Text.of(data['jid'] ?? null),
      status: connected ? 'connected' : 'disconnected',
      connected,
      raw: body,
    });
  }

  /**
   * Terima balasan `GET /session/status`.
   *
   * `Connected` berarti websocket sudah terbentuk, `LoggedIn` berarti QR-nya
   * sudah dipindai dan sesi benar-benar siap dipakai. Yang menentukan bisa
   * tidaknya mengirim pesan adalah `LoggedIn`.
   */
  static fromStatus(body: JsonObject): Session {
    const data = Envelope.data(body);
    const connected = data['Connected'] === true;
    const loggedIn = data['LoggedIn'] === true;

    return new Session({
      provider: WUZAPI_NAME,
      status: loggedIn ? 'connected' : connected ? 'connecting' : 'disconnected',
      connected: loggedIn,
      raw: body,
    });
  }
}
