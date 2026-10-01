import { hasKey } from '../../internal/scalar';
import { ConfigurationException } from '../../exceptions';
import type { PlannedMessage } from '../abstract-provider';
import { FonnteMessage, type FonnteLine } from './fonnte-message';

/**
 * Kumpulan pesan untuk satu request Fonnte.
 *
 * Fonnte menerima seluruh pesan sekaligus dalam satu field `data`, jadi bentuk
 * bulk-nya hanya soal menyusun array — tidak ada endpoint terpisah, dan tidak
 * ada kesempatan menyisipkan jeda di antara pesan di sisi SDK.
 */
export class FonnteBulkMessage {
  private readonly messageWhatsapp: FonnteLine[] = [];

  /**
   * @param messages `delay` sudah diselesaikan `AbstractProvider.plan()`,
   *                 termasuk bagian pacing-nya.
   */
  constructor(messages: PlannedMessage[]) {
    messages.forEach((message, i) => {
      // `plan()` selalu mengisi kedua kunci ini, jadi pemeriksaan di bawah
      // tidak akan pernah menyala lewat jalur normal. Ia tetap ada untuk
      // pemanggil JavaScript yang menyusun kelas ini langsung dan melewati
      // pemeriksaan tipe — persis peran `isset()` di versi PHP.
      const raw = message as unknown as Record<string, unknown>;

      if (!hasKey(raw, 'destination') || !hasKey(raw, 'message')) {
        throw new ConfigurationException(
          `Pesan ke-${i} harus berupa array dengan kunci 'destination' dan 'message'`,
        );
      }

      this.messageWhatsapp.push(
        new FonnteMessage(
          message.destination,
          message.message,
          message.delay ?? FonnteMessage.DEFAULT_DELAY,
        ).toArray(),
      );
    });
  }

  toArray(): FonnteLine[] {
    return this.messageWhatsapp;
  }

  toJson(): string {
    return JSON.stringify(this.toArray());
  }
}
