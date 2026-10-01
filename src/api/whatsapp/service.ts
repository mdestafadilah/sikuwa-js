import {
  Client,
  Config,
  File,
  Fonnte,
  FonnteBulkMessage,
  HttpExecutor,
  Pacing,
  PhoneNumber,
  Presence,
  Throttle,
  Typing,
  type FetchLike,
  type MessageInput,
  type PacingSpec,
  type ThrottleSpec,
  type TypingSpec,
} from "../../lib/sikuwa";

/**
 * Logika playground untuk pustaka SIKUWA hasil porting.
 *
 * Seluruh isi berkas ini **tidak menyentuh jaringan**. Yang ditampilkan adalah
 * keputusan yang memang murni: berapa detik jeda yang akan dipakai, berapa lama
 * indikator mengetik tampil, bagaimana sebuah nomor dinormalkan, bagaimana
 * sebuah berkas diterjemahkan ke bentuk tiap gateway, dan payload apa persisnya
 * yang akan dikirim. Jadi halaman ini bisa dipakai memeriksa `.env` tanpa
 * mengirim satu pesan pun.
 */

/**
 * Nama gateway yang dikenali.
 *
 * Diambil dari registri milik `Client`, bukan ditulis ulang: daftar yang
 * disalin cepat atau lambat akan berbeda dari yang benar-benar dikenali SDK,
 * dan playground adalah tempat perbedaan itu paling menyesatkan.
 */
export const PROVIDERS: string[] = Object.keys(Client.providers());

/** Panjang pesan bawaan yang dipakai contoh, dalam karakter. */
const DEFAULT_LENGTHS = [12, 60, 150, 300, 900];

/**
 * Contoh pesan untuk pratinjau payload, dipakai bila pemanggil tidak mengirim
 * daftar pesan sendiri.
 */
const DEFAULT_MESSAGES = [
  { destination: "081234567890", message: "Halo, ini contoh pesan pertama." },
  { destination: "081298765432", message: "Pesan kedua, ke nomor yang berbeda." },
];

/**
 * Klien HTTP yang selalu gagal, dipasang pada pratinjau payload.
 *
 * Pratinjau tidak pernah memanggilnya — `plan()` dan `FonnteBulkMessage` murni
 * perhitungan. Justru itu gunanya: kalau suatu saat jalur ini tanpa sengaja
 * menyentuh pengiriman, halamannya langsung gagal alih-alih benar-benar
 * menembak `api.fonnte.com`.
 */
const NEVER_SENDS: FetchLike = () => {
  throw new Error("Pratinjau payload tidak boleh menyentuh jaringan");
};

/**
 * Fonnte yang tidak bisa mengirim apa pun.
 *
 * `plan()` dan `repeatedTargets()` bersifat `protected` di `AbstractProvider`
 * — memang begitu juga di versi PHP — jadi kelas ini hanya membukanya untuk
 * halaman playground, tanpa mengubah pustakanya.
 */
class FonnteDryRun extends Fonnte {
  planFor(message: MessageInput) {
    return this.plan(message);
  }
}

/** Sembunyikan kredensial sebelum dikirim ke peramban. */
function mask(secret: string): string {
  if (secret === "") return "(kosong)";
  if (secret.length <= 4) return "••••";

  return `${secret.slice(0, 4)}••••`;
}

export interface PacingPreviewRequest {
  pacing?: PacingSpec | null;
  lengths?: number[] | null;
}

export interface TypingPreviewRequest {
  typing?: TypingSpec | null;
  lengths?: number[] | null;
}

export interface ThrottlePreviewRequest {
  throttle?: ThrottleSpec | null;
  count?: number | null;
}

export interface PlanPreviewRequest {
  messages?: unknown;
  pacing?: PacingSpec | null;
  typing?: TypingSpec | null;
  throttle?: ThrottleSpec | null;
}

/** Panjang pesan yang dipakai bila pemanggil tidak menyebutkan. */
function lengthsOf(lengths: number[] | null | undefined): number[] {
  if (!Array.isArray(lengths) || lengths.length === 0) return DEFAULT_LENGTHS;

  return lengths
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.trunc(value))
    .slice(0, 50);
}

/**
 * Rapikan daftar pesan dari peramban.
 *
 * Hanya `destination`, `message`, `delay`, dan `typing` yang diteruskan —
 * bentuk yang memang dibaca SDK. Kunci lain dibuang supaya pratinjau tidak
 * memberi kesan bahwa kunci itu berpengaruh.
 */
function messagesOf(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return DEFAULT_MESSAGES.map((message) => ({ ...message }));
  }

  return messages.slice(0, 20).map((item) => {
    if (typeof item !== "object" || item === null) {
      return { destination: "", message: "" };
    }

    const record = item as Record<string, unknown>;
    const out: Record<string, unknown> = {
      destination: String(record["destination"] ?? ""),
      message: String(record["message"] ?? ""),
    };

    // Dibiarkan apa adanya, termasuk `null`: `delay: null` berarti "terserah
    // pacing", dan itu berbeda dari kunci yang tidak disebut sama sekali.
    if ("delay" in record) out["delay"] = record["delay"];
    if ("typing" in record) out["typing"] = record["typing"];

    return out;
  });
}

class WhatsappPlaygroundService {
  /** Ringkasan konfigurasi efektif, dengan seluruh kredensial disamarkan. */
  describeConfig(config: Config) {
    const pacing = config.pacing();
    const typing = config.typing();
    const throttle = config.throttle();

    return {
      provider: config.provider() ?? "(belum dipilih)",
      notifikasiAktif: Config.notificationEnabled(),
      timeout: config.timeout(),
      percobaanUlang: config.retries(),
      token: mask(config.token()),
      url: config.url(),
      session: config.session(),
      instance: config.instance(),
      tokenAkun: mask(config.accountToken()),
      headerTambahan: Object.keys(config.headers()),
      // Kunci per-provider sengaja ditampilkan terpisah: inilah yang membuat
      // beberapa gateway self-hosted bisa dikonfigurasi bersamaan.
      gateway: PROVIDERS.map((name) => ({
        nama: name,
        tokenTerisi: config.providerToken(name) !== null,
        url: config.url("", name),
        session: config.session(name),
        instance: config.instance(name),
      })),
      pacing: {
        aktif: pacing.isEnabled(),
        siklus: pacing.cycle(),
        interval: pacing.interval(),
        ambangPesanPanjang: pacing.longChars(),
        pengaliPesanPanjang: pacing.longFactor(),
      },
      typing: {
        aktif: typing.isEnabled(),
        kecepatan: typing.speed(),
        min: typing.min(),
        max: typing.max(),
      },
      throttle: {
        aktif: throttle.isEnabled(),
        max: throttle.max(),
        window: throttle.window(),
      },
    };
  }

  /**
   * Jeda yang akan dipakai untuk serangkaian pesan.
   *
   * Opsi yang dikirim pemanggil digabung dengan environment, bukan
   * menggantikannya — persis seperti penimpaan per panggilan di SDK: yang tidak
   * disebutkan tetap memakai nilai dari `.env`.
   */
  previewPacing(request: PacingPreviewRequest, config: Config) {
    const pacing: Pacing = config.pacing().merge(request.pacing ?? null);
    const lengths = lengthsOf(request.lengths);

    return {
      aktif: pacing.isEnabled(),
      siklus: pacing.cycle(),
      interval: pacing.interval(),
      ambangPesanPanjang: pacing.longChars(),
      pengaliPesanPanjang: pacing.longFactor(),
      // `null` berarti "tidak ada aturan"; `0` berarti "aturan aktif, dan pesan
      // ini memang tidak perlu ditunggu". Keduanya berbeda, jadi dibiarkan apa
      // adanya alih-alih diseragamkan menjadi nol.
      jeda: lengths.map((panjang, index) => ({
        urutan: index,
        panjang,
        detik: pacing.delayFor(index, panjang),
      })),
    };
  }

  /** Lama indikator "sedang mengetik" untuk tiap panjang pesan. */
  previewTyping(request: TypingPreviewRequest, config: Config) {
    const typing: Typing = config.typing().merge(request.typing ?? null);
    const lengths = lengthsOf(request.lengths);

    return {
      aktif: typing.isEnabled(),
      kecepatan: typing.speed(),
      min: typing.min(),
      max: typing.max(),
      durasi: lengths.map((panjang) => ({
        panjang,
        detik: typing.durationFor(panjang),
      })),
    };
  }

  /** Jadwal pembatas laju untuk satu batch berisi `count` pesan. */
  previewThrottle(request: ThrottlePreviewRequest, config: Config) {
    const throttle: Throttle = config.throttle().merge(request.throttle ?? null);
    const count = Math.min(50, Math.max(0, Math.trunc(Number(request.count ?? 6)) || 0));

    return {
      aktif: throttle.isEnabled(),
      max: throttle.max(),
      window: throttle.window(),
      jadwal: throttle.schedule(count).map((detik, urutan) => ({ urutan, detik })),
    };
  }

  /** Terjemahkan permintaan indikator ke kosakata baku. */
  describePresence(state: string, duration: unknown) {
    const presence = Presence.from(state, duration);

    return {
      keadaan: presence.state,
      durasi: presence.duration,
      milidetik: presence.milliseconds(),
      label: presence.label(),
      menampilkanIndikator: presence.showsIndicator(),
    };
  }

  /** Normalisasi nomor ke format internasional sekaligus bentuk WID-nya. */
  normalizePhone(number: string) {
    const normalized = PhoneNumber.normalize(number);

    return {
      masukan: number,
      normalisasi: normalized,
      wid: normalized === "" ? "" : PhoneNumber.toWid(normalized),
      // Fonnte dan Evolution API menolak nomor kosong, jadi ini penanda awal
      // yang berguna sebelum benar-benar mengirim.
      terpakai: normalized !== "",
    };
  }

  /** Bentuk berkas menurut tiap gateway, tanpa mengunggah apa pun. */
  inspectMedia(payload: string, filename: string) {
    const file = File.from(payload, filename);

    return {
      jenis: file.mime,
      namaBerkas: file.filename,
      gambar: file.isImage(),
      url: file.isUrl(),
      ukuran: file.size(),
      ukuranTerbaca: file.readableSize(),
      batasWhatsApp: File.WHATSAPP_MAX_BYTES,
      melebihiBatas: file.exceedsLimit(),
      // Tiga bentuk yang diminta gateway yang berbeda-beda, dihitung sekaligus
      // supaya perbedaannya terlihat berdampingan.
      dataUri: `${file.dataUri().slice(0, 48)}${file.dataUri().length > 48 ? "…" : ""}`,
      panjangBase64: file.base64().length,
    };
  }

  /**
   * Payload yang **benar-benar** akan dikirim Fonnte, tanpa mengirim apa pun.
   *
   * Inilah cara melihat kerja `AbstractProvider.plan()` dari luar: jeda tiap
   * pesan, lama indikator ketiknya, dan JSON akhir yang masuk ke field `data`.
   * Seluruh perhitungannya sama persis dengan jalur kirim sungguhan — yang
   * tidak ada hanya request-nya.
   *
   * URL tidak ikut ditampilkan dengan sengaja: payload tidak bergantung
   * padanya, dan `Config.fromEnvironment()` memasukkan `WHATSAPP_URL` ke opsi
   * `url` — yang oleh Fonnte dibaca sebagai URL eksplisit. Menampilkannya di
   * sini hanya akan menyesatkan.
   */
  previewPlan(request: PlanPreviewRequest, config: Config) {
    const provider = new FonnteDryRun(
      config,
      new HttpExecutor(NEVER_SENDS, config.timeout(), config.headers()),
    );

    const message = {
      messages: messagesOf(request.messages),
      pacing: request.pacing ?? null,
      typing: request.typing ?? null,
      throttle: request.throttle ?? null,
    } as unknown as MessageInput;

    const items = provider.planFor(message);

    return {
      gateway: Fonnte.NAME,
      jumlahPesan: items.length,
      // Dihitung SDK sendiri, bukan oleh gateway: mengirim ke satu nomor
      // berkali-kali dalam satu panggilan adalah pola yang paling cepat
      // memicu pemblokiran.
      tujuanBerulang: provider.repeatedTargets(message),
      pesan: items,
      // Fonnte menerima seluruh batch dalam satu field bernama `data`, berisi
      // JSON — bukan satu request per pesan.
      field: "data",
      payload: new FonnteBulkMessage(items).toJson(),
    };
  }
}

export const whatsappPlaygroundService = new WhatsappPlaygroundService();
