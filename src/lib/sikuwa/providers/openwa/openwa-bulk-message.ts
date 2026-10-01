import { ConfigurationException } from '../../exceptions';
import { hasKey } from '../../internal/scalar';
import type { PlannedMessage } from '../abstract-provider';
import { OpenWAMessage } from './openwa-message';

/**
 * Body `POST .../messages/send-bulk`.
 *
 * `type`, bukan `interface` — lihat catatan yang sama di `OpenWATextPayload`.
 */
export type OpenWABulkPayload = {
  messages: ReturnType<OpenWAMessage['toBulkItem']>[];
  options: {
    delayBetweenMessages: number;
    randomizeDelay: boolean;
    stopOnError: boolean;
  };
};

/**
 * Kumpulan pesan untuk endpoint `send-bulk` OpenWA.
 *
 * Berbeda dari Fonnte, OpenWA punya endpoint batch tersendiri dan **satu**
 * angka jeda untuk seluruh batch — bukan jeda per pesan. Karena itu jedanya
 * diserahkan lewat konstruktor, bukan dibaca dari tiap pesan.
 *
 * Nomor tujuan yang tidak bisa dibaca ditolak di sini, sebelum ada request
 * apa pun. Pesan error OpenWA untuk kasus ini umumnya hanya berbunyi
 * "chatId tidak valid", yang tidak memberi tahu pesan mana yang salah.
 */
export class OpenWABulkMessage {
  /** Batas item per batch sesuai spesifikasi OpenWA. */
  static readonly MAX_ITEMS = 100;

  /** Jeda bawaan antar pesan, dalam detik, bila pemanggil tidak mengisinya. */
  static readonly DEFAULT_DELAY = 3;

  private readonly items: OpenWAMessage[] = [];

  private readonly delaySeconds: number;

  /**
   * @param messages      `delay` sudah diselesaikan `AbstractProvider.plan()`,
   *                      termasuk bagian pacing-nya.
   * @param delaySeconds  Jeda untuk seluruh batch, dalam detik.
   */
  constructor(
    messages: PlannedMessage[],
    delaySeconds: number = OpenWABulkMessage.DEFAULT_DELAY,
  ) {
    this.delaySeconds = delaySeconds;

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

      const item = new OpenWAMessage(message.destination, message.message);

      // `toWid()` membentuk "@c.us" begitu nomornya kosong, dan itu akan
      // ditolak server dengan pesan yang tidak menjelaskan apa-apa.
      if (item.chatId === '' || item.chatId.startsWith('@')) {
        throw new ConfigurationException(`Pesan ke-${i} tidak punya nomor tujuan yang valid`);
      }

      this.items.push(item);
    });

    if (this.items.length > OpenWABulkMessage.MAX_ITEMS) {
      throw new ConfigurationException(
        `OpenWA membatasi ${OpenWABulkMessage.MAX_ITEMS} pesan per batch, ` +
          `diberikan ${this.items.length}`,
      );
    }
  }

  all(): OpenWAMessage[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  first(): OpenWAMessage | null {
    return this.items[0] ?? null;
  }

  toArray(): OpenWABulkPayload {
    // `delayBetweenMessages` dalam milidetik, dibatasi 1000-60000 oleh OpenWA.
    // Nilai di luar rentang itu ditolak gateway, jadi penjepitan di sini
    // mengubah permintaan yang pasti gagal menjadi permintaan yang jalan.
    const delayMs = Math.min(60000, Math.max(1000, this.delaySeconds * 1000));

    return {
      messages: this.items.map((message) => message.toBulkItem()),
      options: {
        delayBetweenMessages: delayMs,
        randomizeDelay: true,
        stopOnError: false,
      },
    };
  }

  toJson(): string {
    return JSON.stringify(this.toArray());
  }
}
