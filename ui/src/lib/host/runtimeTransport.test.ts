import {
  getRequestBaseUrl,
  getRuntimeConfig,
  resetRuntimeConfigCacheForTests,
  useSameOriginDesktopProxy,
} from './runtimeTransport.js';

describe('runtimeTransport', () => {
  afterEach(() => {
    resetRuntimeConfigCacheForTests();
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
          port: '5177',
        },
        '5177'
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
        '5177'
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
          port: '5177',
        },
        '5177'
      )
    ).toBe('');
  });

  it('falls back to the web runtime config when no desktop bridge is present', async () => {
    await expect(getRuntimeConfig({ bridge: null })).resolves.toEqual({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
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
          }),
        },
      })
    ).resolves.toEqual({
      apiBaseUrl: 'http://127.0.0.1:3000',
      desktopToken: 'abc123',
      isDesktop: true,
    });
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