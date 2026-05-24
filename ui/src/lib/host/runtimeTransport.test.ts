import {
  getRuntimeTokenHeader,
  getRequestBaseUrl,
  getRuntimeConfig,
  resetRuntimeConfigCacheForTests,
  useSameOriginDesktopProxy,
} from './runtimeTransport.js';

describe('runtimeTransport', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    resetRuntimeConfigCacheForTests();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('uses the same-origin desktop proxy only for desktop on the configured dev port', () => {
    const runtimeConfig = {
      apiBaseUrl: 'http://127.0.0.1:3000',
      desktopToken: 'token',
      isDesktop: true,
    };

    expect(
      useSameOriginDesktopProxy(
        runtimeConfig,
        {
          protocol: 'http:',
          hostname: '127.0.0.1',
          port: '6177',
        },
        '6177'
      )
    ).toBe(true);

    expect(
      useSameOriginDesktopProxy(
        runtimeConfig,
        {
          protocol: 'http:',
          hostname: '127.0.0.1',
          port: '4173',
        },
        '6177'
      )
    ).toBe(false);
  });

  it('returns an empty request base url when the same-origin desktop proxy is active', () => {
    const runtimeConfig = {
      apiBaseUrl: 'http://127.0.0.1:3000',
      desktopToken: 'token',
      isDesktop: true,
    };

    expect(
      getRequestBaseUrl(
        runtimeConfig,
        {
          protocol: 'http:',
          hostname: 'localhost',
          port: '6177',
        },
        '6177'
      )
    ).toBe('');
  });

  it('falls back to the web runtime config when no desktop bridge is present', async () => {
    await expect(getRuntimeConfig({ bridge: null })).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'web',
      runtimeOwner: 'embedded',
    });
  });

  it('normalizes a bridge runtime config', async () => {
    await expect(
      getRuntimeConfig({
        bridge: {
          getRuntimeConfig: async () => ({
            apiBaseUrl: 'http://127.0.0.1:3000',
            desktopToken: 'abc123',
            isDesktop: true,
            runtimeHostKind: 'desktop',
            runtimeOwner: 'embedded',
          }),
        },
      })
    ).resolves.toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
      desktopToken: 'abc123',
      isDesktop: true,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'desktop',
      runtimeOwner: 'embedded',
    });
  });

  it('forces injected phone runtime ownership to embedded', async () => {
    await expect(
      getRuntimeConfig({
        injectedConfig: {
          apiBaseUrl: 'https://nearbytes.test',
          desktopToken: 'desktop-token-should-be-ignored',
          runtimeHostKind: 'phone',
          runtimeOwner: 'desktop-proxy',
          runtimeTokenHeader: 'x-nearbytes-runtime-token',
        },
      })
    ).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
    });
  });

  it('drops bridge host transport fields for phone runtimes', async () => {
    await expect(
      getRuntimeConfig({
        bridge: {
          getRuntimeConfig: async () => ({
            apiBaseUrl: 'http://127.0.0.1:3000',
            desktopToken: 'abc123',
            isDesktop: false,
            runtimeHostKind: 'phone',
            runtimeOwner: 'desktop-proxy',
          }),
        },
      })
    ).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
    });
  });

  it('accepts injected phone runtime identity without requiring an api base url', async () => {
    await expect(
      getRuntimeConfig({
        injectedConfig: {
          runtimeHostKind: 'phone',
          runtimeOwner: 'embedded',
        },
      })
    ).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
    });
  });

  it('defaults native runtimes without injected config to embedded phone hosting', async () => {
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
      },
    } as Window;

    await expect(getRuntimeConfig({ bridge: null })).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
    });
  });

  it('forces injected native runtimes to embedded phone hosting even with desktop-style fields', async () => {
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
      },
      nearbytesRuntimeConfig: {
        apiBaseUrl: 'https://nearbytes.test',
        desktopToken: 'abc123',
      },
    } as unknown as Window;

    await expect(getRuntimeConfig({ bridge: null })).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
    });
  });

  it('defaults runtimes to the generic runtime token header', () => {
    expect(
      getRuntimeTokenHeader({
        apiBaseUrl: 'http://127.0.0.1:3000',
        desktopToken: 'token',
        isDesktop: true,
      })
    ).toBe('x-nearbytes-runtime-token');
  });

  it('respects an explicit runtime token header override', () => {
    expect(
      getRuntimeTokenHeader({
        apiBaseUrl: 'http://127.0.0.1:3000',
        desktopToken: 'token',
        isDesktop: true,
        runtimeTokenHeader: 'x-nearbytes-desktop-token',
      })
    ).toBe('x-nearbytes-desktop-token');
  });

  it('rejects an invalid bridge runtime config', async () => {
    await expect(
      getRuntimeConfig({
        bridge: {
          getRuntimeConfig: async () => ({
            apiBaseUrl: '',
            desktopToken: '',
            isDesktop: true,
          }),
        },
      })
    ).rejects.toThrow('Nearbytes desktop bridge returned invalid runtime config.');
  });
});