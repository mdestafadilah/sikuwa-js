import { debugType, isNumeric, isScalar, toFloat } from '../internal/scalar';
import { ConfigurationException } from '../exceptions';

/**
 * Keadaan "sedang mengetik" yang diminta pemanggil, dinormalkan ke satu
 * kosakata sebelum diterjemahkan tiap gateway.
 *
 * Kelima gateway menyebut hal yang sama dengan kata yang berbeda: OpenWA
 * memakai `typing`, ApiMe menerima `typing` maupun `composing`, Evolution API
 * dan wuzapi memakai `composing`, dan Fonnte tidak punya keadaan sama sekali —
 * ia hanya kenal "mulai mengetik" dan "berhenti". Pemanggil cukup menulis satu
 * istilah, dan padanannya diurus di sini, bukan diulang di lima provider.
 *
 * Objek ini juga yang menegakkan satu aturan yang tidak boleh diserahkan ke
 * masing-masing provider: **durasi wajib ada saat indikator ditampilkan**.
 * Fonnte menuntutnya di sisi server, sedangkan Evolution API menunggu selama
 * durasi itu lalu menghapus indikatornya sendiri — dengan durasi 0 keduanya
 * tidak menampilkan apa pun, dan kegagalannya senyap.
 */
export class Presence {
  /** Indikator "sedang mengetik". */
  static readonly COMPOSING = 'composing';

  /** Menghapus indikator yang sedang tampil. */
  static readonly PAUSED = 'paused';

  /** Indikator "sedang merekam suara". Tidak semua gateway punya. */
  static readonly RECORDING = 'recording';

  /**
   * Istilah lain yang diterima, dipetakan ke kosakata baku di atas.
   *
   * Sengaja lengkap: pemanggil yang sudah terbiasa dengan salah satu gateway
   * akan menulis istilah gateway itu, dan menolaknya hanya karena beda kata
   * akan terasa seperti kesalahan yang dibuat-buat.
   */
  private static readonly ALIASES: Record<string, string> = {
    composing: Presence.COMPOSING,
    compose: Presence.COMPOSING,
    typing: Presence.COMPOSING,
    type: Presence.COMPOSING,
    menulis: Presence.COMPOSING,
    paused: Presence.PAUSED,
    pause: Presence.PAUSED,
    stop: Presence.PAUSED,
    stopped: Presence.PAUSED,
    clear: Presence.PAUSED,
    berhenti: Presence.PAUSED,
    recording: Presence.RECORDING,
    record: Presence.RECORDING,
    audio: Presence.RECORDING,
    suara: Presence.RECORDING,
  };

  private constructor(
    /** Salah satu dari {@link COMPOSING}, {@link PAUSED}, {@link RECORDING}. */
    readonly state: string,
    /** Lama indikator ditampilkan, dalam detik. 0 berarti tidak ada durasi. */
    readonly duration: number,
  ) {}

  /**
   * Susun keadaan dari kunci pesan pemanggil.
   *
   * `duration` sengaja bertipe `unknown`, bukan `number | string | null`:
   * nilainya datang langsung dari array pesan pemanggil, dan tipe yang sempit
   * hanya memindahkan kegagalannya menjadi error tipe — bukan
   * ConfigurationException yang menjelaskan cara memperbaikinya.
   *
   * @param state    Keadaan yang diminta; kosong berarti {@link COMPOSING}.
   * @param duration Lama indikator ditampilkan, dalam detik. Wajib saat
   *                 menampilkan indikator.
   */
  static from(state = '', duration: unknown = null): Presence {
    const canonical = Presence.canonical(state);
    const seconds = Presence.seconds(duration);

    // Fonnte dan Evolution API memakai durasi untuk menentukan berapa lama
    // indikator tampil. Tanpa angka, keduanya tidak menampilkan apa pun —
    // jadi lebih baik ditolak di sini daripada gagal tanpa jejak.
    if (canonical !== Presence.PAUSED && seconds === null) {
      throw new ConfigurationException(
        `Keadaan '${canonical}' membutuhkan kunci 'duration' dalam detik, mis. ` +
          `['destination' => '081234567890', 'state' => '${canonical}', 'duration' => 5]. ` +
          'Tanpa durasi, Fonnte dan Evolution API tidak menampilkan indikator sama sekali',
      );
    }

    return new Presence(canonical, seconds ?? 0);
  }

  /** Apakah keadaan ini menampilkan indikator, bukan menghapusnya? */
  showsIndicator(): boolean {
    return !this.isPaused();
  }

  isComposing(): boolean {
    return this.state === Presence.COMPOSING;
  }

  isPaused(): boolean {
    return this.state === Presence.PAUSED;
  }

  isRecording(): boolean {
    return this.state === Presence.RECORDING;
  }

  /** Durasi dalam milidetik — satuan yang dipakai Evolution API. */
  milliseconds(): number {
    return this.duration * 1000;
  }

  /** Sebutan keadaan ini untuk pesan hasil, supaya seragam di semua provider. */
  label(): string {
    switch (this.state) {
      case Presence.PAUSED:
        return 'berhenti mengetik';
      case Presence.RECORDING:
        return 'sedang merekam suara';
      default:
        return 'sedang mengetik';
    }
  }

  private static canonical(state: string): string {
    const trimmed = state.trim();

    if (trimmed === '') return Presence.COMPOSING;

    const canonical = Presence.ALIASES[trimmed.toLowerCase()];

    if (canonical === undefined) {
      throw new ConfigurationException(
        `Keadaan '${trimmed}' tidak dikenal. Pilih salah satu: ` +
          `${Presence.COMPOSING}, ${Presence.PAUSED}, atau ${Presence.RECORDING}` +
          ' (istilah gateway seperti "typing", "stop", dan "audio" juga diterima)',
      );
    }

    return canonical;
  }

  /**
   * Ubah durasi menjadi detik bulat, atau null bila memang tidak disebut.
   */
  private static seconds(duration: unknown): number | null {
    if (duration === null || duration === undefined || duration === '') return null;

    if (!isScalar(duration) || !isNumeric(duration)) {
      const shown = isScalar(duration) ? `'${String(duration)}'` : debugType(duration);

      throw new ConfigurationException(
        `Kunci 'duration' harus berupa angka detik, bukan ${shown}`,
      );
    }

    const seconds = Math.ceil(toFloat(duration));

    // 0 dan negatif sama saja artinya di sini: indikator tidak akan sempat
    // terlihat. Evolution API bahkan akan mengirim composing lalu langsung
    // paused tanpa jeda, sehingga pemanggil mengira sudah berhasil.
    if (seconds <= 0) {
      throw new ConfigurationException(
        `Kunci 'duration' harus minimal 1 detik; nilai ${toFloat(duration)}` +
          ' membuat indikator tidak sempat terlihat',
      );
    }

    return seconds;
  }
}
