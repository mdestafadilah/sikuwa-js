import { hasKey, toPhpBool } from '../../internal/scalar';
import { ConfigurationException } from '../../exceptions';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { PhoneNumber } from '../../support/phone-number';
import { Text } from '../../support/text';
import { FONNTE_NAME } from './constants';

/**
 * Perangkat Fonnte — menyusun payload `POST /add-device` dan menormalkan
 * balasan Device API menjadi `Session`.
 *
 * Istilah Fonnte untuk "sesi" adalah *device* (perangkat). Dua hal yang mudah
 * tertukar dan sengaja dibedakan di sini:
 *
 * - **Token perangkat** — yang dipakai mengirim pesan, tersimpan di
 *   `WHATSAPP_TOKEN`. Perangkat yang baru dibuat menerbitkannya, dan nilainya
 *   dikembalikan lewat `Session.token`.
 * - **Token akun** — yang dipakai mengurus perangkat. Device API menolak
 *   token perangkat dengan `"unknown user"`.
 *
 * `POST /add-device` mengembalikan `status` sebagai *keberhasilan permintaan*
 * (boolean), bukan keadaan sambungan — perangkat yang baru dibuat belum
 * tersambung. `POST /get-devices` baru memakai `status` sebagai keadaan
 * sesungguhnya (`connect` / `disconnect`). Keduanya punya penormal sendiri
 * supaya perbedaan itu tidak hilang.
 */
export class FonnteSession {
  /** Nilai `status` perangkat yang berarti siap mengirim pesan. */
  static readonly CONNECTED = 'connect';

  /**
   * Payload untuk POST /add-device.
   *
   * Kunci yang dikenali: `name` (wajib), `device` (wajib), dan opsional
   * `autoread`, `personal`, `group`.
   */
  static payload(options: Record<string, unknown>): Record<string, unknown> {
    const name = Text.of(options['name']);

    if (name === '') {
      throw new ConfigurationException(
        'Fonnte membutuhkan nama perangkat: kirim { name: ... }',
      );
    }

    const device = PhoneNumber.normalize(Text.of(options['device']));

    if (device === '') {
      throw new ConfigurationException(
        "Fonnte membutuhkan nomor perangkat: kirim { device: '0812...' }",
      );
    }

    const payload: Record<string, unknown> = { name, device };

    // Fonnte membaca flag ini sebagai string "true"/"false", bukan boolean.
    // Nilainya sendiri tetap diuji dengan kebenaran gaya PHP, karena
    // pemanggil bisa mengirim apa saja.
    for (const flag of ['autoread', 'personal', 'group']) {
      if (hasKey(options, flag)) {
        payload[flag] = toPhpBool(options[flag]) ? 'true' : 'false';
      }
    }

    return payload;
  }

  /** Terima balasan `POST /add-device`. */
  static fromCreated(body: JsonObject): Session {
    return new Session({
      provider: FONNTE_NAME,
      id: Text.of(body['device']),
      // `status` di sini adalah keberhasilan permintaan, jadi sesi belum
      // bisa dipakai sampai perangkatnya tersambung.
      status: body['status'] === true ? 'created' : 'unknown',
      connected: false,
      token: Text.of(body['token']),
      phoneNumber: Text.of(body['device']),
      profileName: Text.of(body['name']),
      raw: body,
    });
  }

  /**
   * Terima satu entri dari `POST /get-devices`.
   *
   * @param body Amplop lengkap, untuk `Session.raw`.
   */
  static fromDevice(device: JsonObject, body: JsonObject = {}): Session {
    const status = Text.of(device['status']);

    return new Session({
      provider: FONNTE_NAME,
      id: Text.of(device['device']),
      status,
      // `strcasecmp()` PHP: sama tanpa peduli besar-kecil huruf.
      connected: status.toLowerCase() === FonnteSession.CONNECTED,
      token: Text.of(device['token']),
      phoneNumber: Text.of(device['device']),
      profileName: Text.of(device['name']),
      raw: Object.keys(body).length === 0 ? device : body,
    });
  }

  /**
   * Cari satu perangkat di dalam balasan `POST /get-devices`.
   *
   * Pencocokan mencoba nomor, nama, lalu token sekaligus: pemanggil biasanya
   * hanya punya salah satunya, dan menuntut satu bentuk tertentu akan membuat
   * pemanggil menyesuaikan diri pada detail internal Fonnte.
   */
  static findDevice(body: JsonObject, needle: string): JsonObject | null {
    const devices = body['data'];

    if (needle === '' || typeof devices !== 'object' || devices === null) {
      return null;
    }

    const list = Array.isArray(devices) ? devices : Object.values(devices);

    for (const device of list) {
      if (typeof device !== 'object' || device === null) continue;

      const candidate = device as JsonObject;

      for (const key of ['device', 'name', 'token']) {
        if (Text.of(candidate[key]) === needle) return candidate;
      }
    }

    return null;
  }
}
