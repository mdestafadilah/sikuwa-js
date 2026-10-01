import { isArrayLike } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Text } from '../../support/text';
import { WAXUM_NAME } from './constants';

/**
 * Sesi Waxum — menyusun payload `POST /sessions` dan menormalkan balasan
 * menjadi {@link Session}.
 *
 * Ketiga endpoint sesi Waxum membungkus datanya dengan cara yang berbeda, jadi
 * masing-masing punya penormal sendiri:
 *
 * - `POST /sessions` membalas `{"session": {...}}`;
 * - `GET /sessions/{id}/status` mengirim objeknya langsung di akar body;
 * - `GET /sessions/{id}` mengirim objek sesinya langsung, tanpa amplop.
 *
 * Statusnya sama di ketiganya — `disconnected`, `connecting`, `waiting_for_qr`,
 * `waiting_for_pair_code`, `connected`, `logged_in`. Yang menentukan sesi bisa
 * dipakai mengirim pesan adalah `is_logged_in`, bukan `connected`: websocket
 * bisa hidup tanpa login, dan sebaliknya.
 */
export class WaxumSession {
  /** Status Waxum yang berarti sesi siap mengirim pesan. */
  static readonly LOGGED_IN = 'logged_in';

  /**
   * Payload untuk `POST /sessions`.
   *
   * Waxum membuat sendiri id sesinya bila tidak disebutkan, tetapi id yang
   * eksplisit tetap dikirim supaya `WHATSAPP_SESSION` bisa diisi sekali dan
   * sesinya punya nama yang tetap. `WHATSAPP_SESSION` dipakai sebagai
   * cadangan, sama seperti gateway lain.
   *
   * @param options     Kunci yang dikenali: `id` (alias `name` untuk namanya),
   *                    `webhook`, `device`.
   * @param defaultName Dipakai kalau `id` tidak diberikan — biasanya dari
   *                    `WHATSAPP_SESSION`.
   */
  static payload(
    options: Record<string, unknown>,
    defaultName = '',
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    // `name` ikut dicoba sebagai id supaya pemanggil yang mengikuti penamaan
    // Waxum sendiri (`{"name": "notif"}`) tetap mendapat id yang tetap,
    // bukan sesi acak yang tidak bisa dicari lagi.
    const id = Text.first(options['id'] ?? null, options['name'] ?? null, defaultName);

    if (id !== '') {
      payload['id'] = id;
    }

    const name = Text.of(options['name'] ?? null);

    if (name !== '') {
      payload['name'] = name;
    }

    // `webhook` dan `device` diteruskan apa adanya: kuncinya milik Waxum dan
    // bisa bertambah antar versi, jadi ia sengaja tidak disalin per kunci.
    // Objek kosong dibuang supaya Waxum tidak menimpanya dengan nilai bawaan.
    const webhook = options['webhook'] ?? null;

    if (isArrayLike(webhook) && Object.keys(webhook).length > 0) {
      payload['webhook'] = webhook;
    }

    const device = options['device'] ?? null;

    if (isArrayLike(device) && Object.keys(device).length > 0) {
      payload['device'] = device;
    }

    return payload;
  }

  /**
   * Terima balasan `POST /sessions`.
   *
   * Objek sesinya bersarang di `session`, sedangkan amplop aslinya tetap
   * disimpan sebagai `raw` supaya field yang tidak dibaca di sini tidak hilang.
   */
  static fromCreate(body: JsonObject, fallbackId = ''): Session {
    const session = isArrayLike(body['session']) ? body['session'] : {};

    return WaxumSession.toSession(session, body, fallbackId);
  }

  /**
   * Terima balasan `GET /sessions/{id}/status` maupun `GET /sessions/{id}`.
   *
   * `status` mengirim `is_logged_in` secara eksplisit; endpoint detail sesi
   * tidak, dan di sana statusnya disimpulkan dari `status`. Keduanya dibaca
   * lewat penanda yang sama supaya pemanggil tidak perlu tahu endpoint mana
   * yang dipanggil.
   */
  static fromStatus(body: JsonObject, fallbackId = ''): Session {
    return WaxumSession.toSession(body, body, fallbackId);
  }

  /**
   * @param data     Objek sesi, dari mana pun ia datang
   * @param envelope Amplop asli, untuk `Session.raw`
   */
  private static toSession(
    data: JsonObject,
    envelope: JsonObject,
    fallbackId: string,
  ): Session {
    const status = Text.of(data['status'] ?? null);

    return new Session({
      provider: WAXUM_NAME,
      id: Text.first(data['id'] ?? null, fallbackId),
      // Status apa adanya: Waxum sudah memakai kata yang jelas
      // (`logged_in`, `waiting_for_qr`), jadi tidak ada yang perlu
      // dinormalkan menjadi huruf besar seperti pada gateway lain.
      status,
      // Dua sinyal yang berbeda dan keduanya sah: flag eksplisit dari
      // endpoint `status`, atau kata statusnya sendiri. `connected` saja
      // TIDAK cukup — websocket bisa hidup tanpa login.
      connected:
        (data['is_logged_in'] ?? null) === true ||
        Text.equalsAny(status, WaxumSession.LOGGED_IN),
      phoneNumber: Text.of(data['phone_number'] ?? null),
      profileName: Text.of(data['push_name'] ?? null),
      raw: envelope,
    });
  }
}
