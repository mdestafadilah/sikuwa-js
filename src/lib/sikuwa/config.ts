import { isNumeric, toFloat, toInt, trimmedScalar, validateBoolean } from './internal/scalar';
import { Pacing, type PacingSpec } from './support/pacing';
import { Throttle, type ThrottleSpec } from './support/throttle';
import { Typing, type TypingSpec } from './support/typing';

/** Pembaca environment yang bisa dipasang pemanggil. */
export type EnvResolver = (key: string) => string | null;

/** Seluruh kunci yang dikenali `Config`, dalam bentuk array opsi. */
export interface ConfigOptions {
  /** Token umum; menang atas `WHATSAPP_TOKEN`. */
  token?: string | null;
  /** URL dasar; menang atas `WHATSAPP_URL`, kalah dari URL per-provider. */
  url?: string | null;
  /** Id session eksplisit; kunci `WHATSAPP_SESSION_<Provider>` tetap menang. */
  session?: string | null;
  /** Id instance eksplisit; kunci `WHATSAPP_INSTANCE_<Provider>` tetap menang. */
  instance?: string | null;
  timeout?: string | number | null;
  /** Token per provider, mis. `{ Fonnte: 'xxx' }`. */
  tokens?: Record<string, string>;
  provider?: string | null;
  /** Header tambahan untuk setiap request. */
  headers?: Record<string, string>;
  /** URL per provider, mis. `{ OpenWA: 'https://wa.internal' }`. */
  urls?: Record<string, string>;
  /** Token akun, khusus Fonnte Device API. */
  account_token?: string | null;
  pacing?: PacingSpec | Pacing | null;
  typing?: TypingSpec | Typing | null;
  throttle?: ThrottleSpec | Throttle | null;
  retries?: string | number | null;
}

/**
 * Sumber konfigurasi tunggal untuk seluruh provider.
 *
 * SDK ini tidak terikat framework. Nilai yang tidak diberikan secara eksplisit
 * dicari lewat {@link env}, yang urutannya:
 *
 * 1. Resolver yang dipasang lewat {@link useResolver} — jalur untuk aplikasi
 *    yang menyimpan konfigurasi di tempat lain (di PHP: helper global `env()`
 *    milik CodeIgniter atau Laravel).
 * 2. `process.env` di Node, Bun, dan Cloudflare Workers.
 *
 * Kunci yang dikenali: `WA_NOTIFICATION`, `WHATSAPP_PROVIDER`,
 * `WHATSAPP_TOKEN`, `WHATSAPP_TOKEN_<Provider>`, `WHATSAPP_URL`,
 * `WHATSAPP_URL_<Provider>`, `WHATSAPP_SESSION`, `WHATSAPP_SESSION_<Provider>`,
 * `WHATSAPP_INSTANCE`, `WHATSAPP_INSTANCE_<Provider>`,
 * `WHATSAPP_ACCOUNT_TOKEN`, `WHATSAPP_TIMEOUT`, `WHATSAPP_RETRIES`,
 * `WHATSAPP_PACING_CYCLE`,
 * `WHATSAPP_PACING_INTERVAL`, `WHATSAPP_PACING_LONG_CHARS`,
 * `WHATSAPP_PACING_LONG_FACTOR`, `WHATSAPP_TYPING`, `WHATSAPP_TYPING_SPEED`,
 * `WHATSAPP_TYPING_MIN`, `WHATSAPP_TYPING_MAX`, `WHATSAPP_THROTTLE_MAX`,
 * `WHATSAPP_THROTTLE_WINDOW`.
 *
 * Nama kuncinya dipertahankan persis seperti versi PHP, supaya berkas `.env`
 * pengguna lama tetap terbaca tanpa perubahan apa pun.
 */
export class Config {
  static readonly DEFAULT_TIMEOUT = 10.0;

  /** Batas atas timeout, dalam detik. */
  static readonly MAX_TIMEOUT = 60.0;

  private static resolver: EnvResolver | null = null;

  private readonly explicitToken: string | null;
  private readonly baseUrl: string | null;
  private readonly sessionId: string | null;
  private readonly instanceId: string | null;
  private readonly timeoutSeconds: string | number | null;
  private readonly tokenMap: Record<string, string>;
  private readonly providerName: string | null;
  private readonly headerMap: Record<string, string>;
  private readonly urlMap: Record<string, string>;
  private readonly accountTokenValue: string | null;
  private readonly pacingOverride: Pacing | null;
  private readonly typingOverride: Typing | null;
  private readonly throttleOverride: Throttle | null;
  private readonly retriesOverride: number | null;

  constructor(options: ConfigOptions = {}) {
    this.explicitToken = options.token ?? null;
    this.baseUrl = options.url ?? null;
    this.sessionId = options.session ?? null;
    this.instanceId = options.instance ?? null;
    this.timeoutSeconds = options.timeout ?? null;
    this.tokenMap = options.tokens ?? {};
    this.providerName = options.provider ?? null;
    this.headerMap = options.headers ?? {};
    this.urlMap = options.urls ?? {};
    this.accountTokenValue = options.account_token ?? null;
    this.pacingOverride = Config.pacingOption(options.pacing);
    this.typingOverride = Config.typingOption(options.typing);
    this.throttleOverride = Config.throttleOption(options.throttle);
    this.retriesOverride =
      options.retries === undefined || options.retries === null ? null : toInt(options.retries);
  }

  /** Terima array opsi, instance Config, atau null. */
  static from(options?: ConfigOptions | Config | null): Config {
    if (options instanceof Config) return options;
    if (options === null || options === undefined) return new Config();

    return new Config({
      token: options.token,
      url: options.url,
      session: options.session,
      instance: options.instance,
      timeout: options.timeout === undefined || options.timeout === null ? null : options.timeout,
      tokens: options.tokens ?? {},
      provider: options.provider,
      headers: options.headers ?? {},
      urls: options.urls ?? {},
      account_token: options.account_token,
      pacing: options.pacing ?? null,
      typing: options.typing ?? null,
      throttle: options.throttle ?? null,
      retries: options.retries === undefined || options.retries === null ? null : options.retries,
    });
  }

  /** Bangun Config murni dari environment. */
  static fromEnvironment(): Config {
    return new Config({
      token: Config.env('WHATSAPP_TOKEN'),
      url: Config.env('WHATSAPP_URL'),
      session: Config.env('WHATSAPP_SESSION'),
      instance: Config.env('WHATSAPP_INSTANCE'),
      timeout: Config.env('WHATSAPP_TIMEOUT') === null ? null : toFloat(Config.env('WHATSAPP_TIMEOUT')),
      provider: Config.env('WHATSAPP_PROVIDER'),
      account_token: Config.env('WHATSAPP_ACCOUNT_TOKEN'),
      pacing: Config.pacingFromEnv(),
      typing: Config.typingFromEnv(),
      throttle: Config.throttleFromEnv(),
      retries: Config.retriesFromEnv(),
    });
  }

  /**
   * Pacing dari environment.
   *
   * Dikumpulkan di satu tempat supaya dua jalur yang memakainya —
   * {@link fromEnvironment} dan {@link pacing} — tidak bisa berbeda diam-diam
   * saat kuncinya bertambah.
   */
  private static pacingFromEnv(): Pacing {
    return Pacing.fromConfig(
      Config.env('WHATSAPP_PACING_CYCLE'),
      Config.env('WHATSAPP_PACING_INTERVAL'),
      Config.env('WHATSAPP_PACING_LONG_CHARS'),
      Config.env('WHATSAPP_PACING_LONG_FACTOR'),
    );
  }

  /**
   * Terima opsi `pacing` dalam bentuk objek jadi maupun array mentah.
   *
   * Null bila pemanggil tidak mengirim apa pun, supaya {@link pacing} masih
   * bisa jatuh ke environment.
   */
  private static pacingOption(value: PacingSpec | Pacing | null | undefined): Pacing | null {
    if (value instanceof Pacing) return value;

    return value !== null && value !== undefined && typeof value === 'object'
      ? Pacing.fromArray(value)
      : null;
  }

  /**
   * Typing dari environment.
   *
   * Sama seperti {@link pacingFromEnv}: dikumpulkan di satu tempat supaya dua
   * jalur yang memakainya tidak bisa berbeda diam-diam saat kuncinya
   * bertambah.
   */
  private static typingFromEnv(): Typing {
    return Typing.fromConfig(
      Config.env('WHATSAPP_TYPING'),
      Config.env('WHATSAPP_TYPING_SPEED'),
      Config.env('WHATSAPP_TYPING_MIN'),
      Config.env('WHATSAPP_TYPING_MAX'),
    );
  }

  /**
   * Terima opsi `typing` dalam bentuk objek jadi maupun array mentah.
   *
   * Null bila pemanggil tidak mengirim apa pun, supaya {@link typing} masih
   * bisa jatuh ke environment.
   */
  private static typingOption(value: TypingSpec | Typing | null | undefined): Typing | null {
    if (value instanceof Typing) return value;

    return value !== null && value !== undefined && typeof value === 'object'
      ? Typing.fromArray(value)
      : null;
  }

  /**
   * Throttle dari environment.
   *
   * Dikumpulkan di satu tempat seperti {@link pacingFromEnv}, supaya dua jalur
   * yang memakainya tidak bisa berbeda diam-diam saat kuncinya bertambah.
   */
  private static throttleFromEnv(): Throttle {
    return Throttle.fromConfig(
      Config.env('WHATSAPP_THROTTLE_MAX'),
      Config.env('WHATSAPP_THROTTLE_WINDOW'),
    );
  }

  /**
   * Terima opsi `throttle` dalam bentuk objek jadi maupun array mentah.
   *
   * Null bila pemanggil tidak mengirim apa pun, supaya {@link throttle} masih
   * bisa jatuh ke environment.
   */
  private static throttleOption(value: ThrottleSpec | Throttle | null | undefined): Throttle | null {
    if (value instanceof Throttle) return value;

    return value !== null && value !== undefined && typeof value === 'object'
      ? Throttle.fromArray(value)
      : null;
  }

  /** Jumlah percobaan ulang otomatis untuk kegagalan yang aman diulang. */
  private static retriesFromEnv(): number | null {
    const value = Config.env('WHATSAPP_RETRIES');

    return value === null || !isNumeric(trimmedScalar(value)) ? null : toInt(trimmedScalar(value));
  }

  /**
   * Pasang resolver environment sendiri. Kirim null untuk kembali ke deteksi
   * otomatis. Utamanya dipakai di test supaya tidak menyentuh environment
   * proses.
   */
  static useResolver(resolver: EnvResolver | null): void {
    Config.resolver = resolver;
  }

  /** Baca satu nilai environment. Mengembalikan null untuk nilai kosong. */
  static env(key: string): string | null {
    const raw = Config.resolver !== null ? Config.resolver(key) : readProcessEnv(key);

    if (raw === null || raw === undefined || typeof raw !== 'string') return null;

    return raw === '' ? null : raw;
  }

  /**
   * Token khusus satu provider: `tokens[<Provider>]`, lalu
   * `WHATSAPP_TOKEN_<Provider>`. Tidak pernah jatuh ke `WHATSAPP_TOKEN`.
   *
   * Dipakai untuk mendeteksi provider mana saja yang benar-benar
   * dikonfigurasi, supaya mode `auto` tidak mengundi gateway tanpa token.
   */
  providerToken(provider: string): string | null {
    const specific = this.tokenMap[provider] ?? Config.env(`WHATSAPP_TOKEN_${provider}`);

    return specific === null || specific === undefined || specific === '' ? null : specific;
  }

  /**
   * URL khusus satu provider: `urls[<Provider>]`, lalu
   * `WHATSAPP_URL_<Provider>`. Tidak pernah jatuh ke `WHATSAPP_URL`.
   *
   * Inilah yang membuat beberapa gateway self-hosted bisa dikonfigurasi
   * bersamaan: `WHATSAPP_URL` hanya punya satu nilai, jadi mengisinya untuk
   * OpenWA akan ikut terpakai Wuzapi. Kunci per-provider tidak punya
   * ambiguitas itu.
   */
  providerUrl(provider: string): string | null {
    const specific = this.urlMap[provider] ?? Config.env(`WHATSAPP_URL_${provider}`);

    return specific === null || specific === undefined || specific === '' ? null : specific;
  }

  /** Token efektif: token khusus provider, lalu token umum, lalu environment. */
  token(provider?: string | null): string {
    if (provider !== null && provider !== undefined) {
      const specific = this.providerToken(provider);

      if (specific !== null) return specific;
    }

    if (this.explicitToken !== null && this.explicitToken !== '') return this.explicitToken;

    return Config.env('WHATSAPP_TOKEN') ?? '';
  }

  /**
   * URL dasar. Urutannya: URL khusus provider, lalu nilai eksplisit, lalu
   * `WHATSAPP_URL`, lalu default provider.
   *
   * Kunci per-provider didahulukan atas nilai eksplisit supaya
   * `WHATSAPP_URL_<Provider>` menang atas `WHATSAPP_URL` — sama seperti
   * {@link providerToken} yang menang atas token umum.
   */
  url(fallback = '', provider?: string | null): string {
    const resolved =
      (provider !== null && provider !== undefined ? this.providerUrl(provider) : null) ??
      this.baseUrl ??
      Config.env('WHATSAPP_URL');

    return rtrimSlashes(resolved === null || resolved === '' ? fallback : resolved);
  }

  /**
   * URL yang diberikan eksplisit saja, tanpa melihat environment.
   *
   * Dipakai provider dengan endpoint tetap (Fonnte): membaca `WHATSAPP_URL`
   * di sana berbahaya, karena satu nilai yang ditujukan untuk gateway
   * self-hosted akan mengalihkan pengiriman ke host yang salah.
   */
  explicitUrl(): string | null {
    return this.baseUrl === null || this.baseUrl === '' ? null : this.baseUrl;
  }

  /**
   * Id session khusus satu provider: `WHATSAPP_SESSION_<Provider>`.
   *
   * Sama seperti {@link providerToken} dan {@link providerUrl}: kunci ini
   * tidak pernah jatuh ke `WHATSAPP_SESSION`. Inilah yang membuat OpenWA,
   * Wwebjs, dan Waxum bisa dikonfigurasi bersamaan — masing-masing bisa
   * memakai nama sesinya sendiri.
   *
   * Nama provider ditulis apa adanya (`WHATSAPP_SESSION_OpenWA`), mengikuti
   * kunci per-provider yang sudah ada, bukan diubah menjadi huruf besar.
   */
  providerSession(provider: string): string | null {
    const specific = Config.env(`WHATSAPP_SESSION_${provider}`);

    return specific === null || specific === '' ? null : specific;
  }

  /**
   * Id/nama instance khusus satu provider: `WHATSAPP_INSTANCE_<Provider>`.
   *
   * Seperti {@link providerSession}, kunci ini tidak pernah jatuh ke
   * `WHATSAPP_INSTANCE`, sehingga ApiMe dan Evolution API bisa punya instance
   * yang berbeda dalam satu aplikasi.
   */
  providerInstance(provider: string): string | null {
    const specific = Config.env(`WHATSAPP_INSTANCE_${provider}`);

    return specific === null || specific === '' ? null : specific;
  }

  /**
   * Id session efektif. Urutannya: kunci khusus provider, lalu nilai
   * eksplisit, lalu `WHATSAPP_SESSION`.
   *
   * Dipakai OpenWA, Wwebjs, dan Waxum. Provider yang tidak memakai session
   * (Fonnte, ApiMe, Evolution API, wuzapi) tetap bisa memanggil ini tanpa
   * akibat apa pun — nilainya memang tidak dipakai di sana.
   */
  session(provider?: string | null): string {
    const specific =
      provider !== null && provider !== undefined ? this.providerSession(provider) : null;

    return (
      specific ??
      (this.sessionId === null || this.sessionId === '' ? null : this.sessionId) ??
      Config.env('WHATSAPP_SESSION') ??
      ''
    );
  }

  /**
   * Id/nama instance efektif. Urutannya: kunci khusus provider, lalu nilai
   * eksplisit, lalu `WHATSAPP_INSTANCE`.
   *
   * Dipakai ApiMe dan Evolution API.
   */
  instance(provider?: string | null): string {
    const specific =
      provider !== null && provider !== undefined ? this.providerInstance(provider) : null;

    return (
      specific ??
      (this.instanceId === null || this.instanceId === '' ? null : this.instanceId) ??
      Config.env('WHATSAPP_INSTANCE') ??
      ''
    );
  }

  /**
   * Token akun — hanya Fonnte, untuk Device API-nya.
   *
   * Sengaja terpisah dari {@link token} karena keduanya kredensial yang
   * berbeda: token perangkat dipakai mengirim pesan, sedangkan menambah dan
   * membaca daftar perangkat menuntut token akun. Menukar keduanya hanya
   * menghasilkan `"unknown user"`.
   */
  accountToken(): string {
    return this.accountTokenValue ?? Config.env('WHATSAPP_ACCOUNT_TOKEN') ?? '';
  }

  /**
   * Pengatur jeda antar pesan saat mengirim beruntun.
   *
   * Berbeda dari kunci lain di kelas ini, bawaannya adalah **mati**: selama
   * `WHATSAPP_PACING_CYCLE` dan `WHATSAPP_PACING_INTERVAL` kosong, jeda
   * diserahkan sepenuhnya ke tiap gateway seperti sebelum fitur ini ada.
   * Pacing yang aktif tapi salah nilainya akan menahan proses pemanggil
   * selama berjam-jam, jadi ia harus dinyalakan dengan sengaja.
   *
   * Nilai eksplisit di konstruktor menang utuh atas environment — tidak
   * digabung sebagian, sama seperti `token` dan `url`.
   */
  pacing(): Pacing {
    return this.pacingOverride ?? Config.pacingFromEnv();
  }

  /**
   * Pengatur indikator "sedang mengetik" yang dimunculkan sebelum mengirim.
   *
   * Sama seperti {@link pacing}, bawaannya **mati**: selama `WHATSAPP_TYPING`
   * kosong, tiap gateway mengirim pesan begitu saja seperti sebelum fitur ini
   * ada. Fitur ini menyisipkan request tambahan ke jalur kirim dan menahan
   * pemanggil selama durasinya, jadi ia harus dinyalakan dengan sengaja.
   *
   * Nilai eksplisit di konstruktor menang utuh atas environment — tidak
   * digabung sebagian, sama seperti `token` dan `url`.
   */
  typing(): Typing {
    return this.typingOverride ?? Config.typingFromEnv();
  }

  /**
   * Pembatas laju pengiriman: berapa pesan boleh keluar per jendela waktu.
   *
   * Melengkapi {@link pacing}, yang hanya mengatur jeda **antar** pesan di
   * dalam satu batch. Pacing tidak melihat aplikasi yang mengirim satu pesan
   * per request — dan justru pola itulah yang paling sering dipakai, sekaligus
   * yang paling mudah menembak terlalu cepat tanpa disadari.
   *
   * Sama seperti pacing dan typing, bawaannya **mati**: selama
   * `WHATSAPP_THROTTLE_MAX` kosong, tidak ada yang berubah dari sebelumnya.
   * Pembatas yang aktif tapi salah nilainya akan menahan pemanggil, jadi ia
   * harus dinyalakan dengan sengaja.
   *
   * Nilai eksplisit di konstruktor menang utuh atas environment — tidak
   * digabung sebagian, sama seperti `token` dan `url`.
   */
  throttle(): Throttle {
    return this.throttleOverride ?? Config.throttleFromEnv();
  }

  /**
   * Berapa kali SDK boleh mencoba ulang sendiri saat gateway menolak dengan
   * 429 atau 503.
   *
   * Hanya dua status itu yang diulang, dan hanya bila gateway menyebut
   * `Retry-After`: status lain tidak akan sembuh kalau diulang (token salah,
   * nomor tidak terdaftar), dan mengulang tanpa tahu berapa lama harus
   * menunggu hanya menambah beban di dinding yang sama.
   *
   * Bawaannya **0** — tanpa percobaan ulang otomatis. Mengulang sendiri
   * berarti menahan proses pemanggil lebih lama, jadi ia harus dinyalakan
   * dengan sengaja, sama seperti pacing dan throttle.
   */
  retries(): number {
    const configured = this.retriesOverride ?? Config.retriesFromEnv();

    return configured === null ? 0 : Math.max(0, configured);
  }

  /**
   * Timeout request dalam detik. Nilai di luar 1–60 diabaikan supaya salah
   * tulis di .env tidak membuat request menggantung selamanya.
   */
  timeout(): number {
    const configured =
      this.timeoutSeconds !== null ? toFloat(this.timeoutSeconds) : toFloat(Config.env('WHATSAPP_TIMEOUT') ?? 0);

    return configured >= 1.0 && configured <= Config.MAX_TIMEOUT
      ? configured
      : Config.DEFAULT_TIMEOUT;
  }

  /** Provider terpilih dari konfigurasi; `auto` berarti undi di antara yang siap. */
  provider(): string | null {
    return this.providerName ?? Config.env('WHATSAPP_PROVIDER');
  }

  /**
   * Apakah notifikasi WhatsApp diaktifkan (`WA_NOTIFICATION`).
   *
   * Bawaannya true kalau kuncinya tidak diisi, supaya SDK tidak diam-diam
   * mematikan diri sendiri hanya karena sebuah variabel lupa ditulis.
   *
   * SDK **tidak pernah** menegakkan nilai ini — SDK tidak tahu kapan
   * notifikasi pantas dikirim. Nilainya disediakan supaya pemanggil tidak
   * perlu mengurai environment sendiri.
   */
  static notificationEnabled(): boolean {
    const value = Config.env('WA_NOTIFICATION');

    return value === null ? true : validateBoolean(value);
  }

  headers(): Record<string, string> {
    return { ...this.headerMap };
  }

  /** Salinan dengan URL berbeda, tanpa mengubah instance asal. */
  withUrl(url?: string | null): Config {
    if (url === null || url === undefined || url === '') return this;

    return new Config({ ...this.optionsSnapshot(), url });
  }

  /** Seluruh opsi apa adanya, dipakai menyusun salinan pada {@link withUrl}. */
  private optionsSnapshot(): ConfigOptions {
    return {
      token: this.explicitToken,
      url: this.baseUrl,
      session: this.sessionId,
      instance: this.instanceId,
      timeout: this.timeoutSeconds,
      tokens: this.tokenMap,
      provider: this.providerName,
      headers: this.headerMap,
      urls: this.urlMap,
      account_token: this.accountTokenValue,
      pacing: this.pacingOverride,
      typing: this.typingOverride,
      throttle: this.throttleOverride,
      retries: this.retriesOverride,
    };
  }
}

/** `rtrim($url, '/')` PHP. */
function rtrimSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Baca satu kunci `process.env`, dengan aman di runtime yang tidak punya. */
function readProcessEnv(key: string): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[key];

  return value === undefined ? null : value;
}
