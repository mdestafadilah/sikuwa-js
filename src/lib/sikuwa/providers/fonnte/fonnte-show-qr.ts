import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { FONNTE_NAME } from './constants';
import { FonnteSession } from './fonnte-session';

/**
 * QR perangkat Fonnte — menormalkan balasan `POST /qr`.
 *
 * Fonnte membalas base64 PNG **telanjang** di field `url`, tanpa awalan
 * `data:` — dokumennya sendiri menyarankan merangkainya menjadi
 * `<img src="data:image/png;base64,…">`. Perangkaian itu dikerjakan
 * `Qr.dataUri()`, jadi pemanggil tidak perlu tahu bedanya.
 *
 * Kalau perangkatnya sudah tersambung, Fonnte tidak mengirim QR melainkan
 * `{"status":false,"reason":"device already connect"}`. Itu keadaan, bukan
 * kegagalan, jadi diterjemahkan menjadi sesi yang `connected`.
 */
export class FonnteShowQr {
  static fromResponse(body: JsonObject): Session {
    const qr = Text.of(body['url']);

    return new Session({
      provider: FONNTE_NAME,
      id: Text.of(body['device']),
      status: qr !== '' ? 'qr_ready' : '',
      connected: false,
      qr: Qr.dataUri(qr),
      raw: body,
    });
  }

  /** Perangkat sudah tersambung, jadi tidak ada QR yang perlu dipindai. */
  static alreadyConnected(body: JsonObject): Session {
    return new Session({
      provider: FONNTE_NAME,
      status: FonnteSession.CONNECTED,
      connected: true,
      raw: body,
    });
  }

  /** Apakah amplop penolakan Fonnte berarti "perangkat sudah tersambung". */
  static isAlreadyConnected(body: JsonObject): boolean {
    return Text.of(body['reason']).toLowerCase().includes('already connect');
  }
}
