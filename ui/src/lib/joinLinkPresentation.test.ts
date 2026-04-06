import {
  joinDialogActionStatusLabel,
  joinDialogActionTitle,
  joinDialogActionTone,
  joinDialogAttachmentTitle,
  joinDialogEndpointLabel,
  joinDialogSpaceSummary,
} from './joinLinkPresentation.js';

describe('joinLinkPresentation', () => {
  it('formats provider-backed endpoint labels for connected and suggested routes', () => {
    expect(
      joinDialogEndpointLabel({
        badges: ['Connected'],
        endpoint: {
          provider: 'mega',
          transport: 'provider-share',
        },
      } as Parameters<typeof joinDialogEndpointLabel>[0])
    ).toBe('MEGA ready here');

    expect(
      joinDialogEndpointLabel({
        badges: ['Suggested folder'],
        endpoint: {
          provider: 'gdrive',
          transport: 'provider-share',
        },
      } as Parameters<typeof joinDialogEndpointLabel>[0])
    ).toBe('Google Drive suggested');
  });

  it('falls back to transport labels when no provider label exists', () => {
    expect(
      joinDialogEndpointLabel({
        badges: [],
        endpoint: {
          transport: 'provider-share',
        },
      } as Parameters<typeof joinDialogEndpointLabel>[0])
    ).toBe('Provider route');

    expect(
      joinDialogEndpointLabel({
        badges: [],
        endpoint: {
          transport: 'lan',
        },
      } as Parameters<typeof joinDialogEndpointLabel>[0])
    ).toBe('Via lan');
  });

  it('summarizes the shared secret payload shape', () => {
    expect(joinDialogSpaceSummary({ mode: 'volume-id', value: 'vol-1' } as Parameters<typeof joinDialogSpaceSummary>[0])).toBe(
      'Needs separate secret'
    );
    expect(
      joinDialogSpaceSummary({ mode: 'secret-file', value: 'file-ref' } as Parameters<typeof joinDialogSpaceSummary>[0])
    ).toBe('Secret file included');
    expect(
      joinDialogSpaceSummary({ mode: 'secret', value: 'secret', password: 'pw' } as Parameters<typeof joinDialogSpaceSummary>[0])
    ).toBe('Secret and password included');
  });

  it('maps join action statuses to tones and labels', () => {
    expect(joinDialogActionTone('attached')).toBe('success');
    expect(joinDialogActionTone('needs-account')).toBe('warning');
    expect(joinDialogActionTone('planned')).toBe('neutral');

    expect(joinDialogActionStatusLabel({ status: 'attached' } as Parameters<typeof joinDialogActionStatusLabel>[0])).toBe('Added');
    expect(joinDialogActionStatusLabel({ status: 'pending-auth' } as Parameters<typeof joinDialogActionStatusLabel>[0])).toBe(
      'Finish sign-in'
    );
    expect(joinDialogActionStatusLabel({ status: 'unsupported' } as Parameters<typeof joinDialogActionStatusLabel>[0])).toBe(
      'Unavailable'
    );
  });

  it('formats attachment and action titles consistently', () => {
    expect(
      joinDialogAttachmentTitle({
        attachment: { label: 'share' },
        selectedEndpoint: {
          endpoint: {
            provider: 'mega',
          },
        },
      } as Parameters<typeof joinDialogAttachmentTitle>[0])
    ).toBe('MEGA shared storage');

    expect(
      joinDialogActionTitle({
        status: 'needs-account',
        provider: 'github',
      } as Parameters<typeof joinDialogActionTitle>[0])
    ).toBe('Connect GitHub');

    expect(
      joinDialogActionTitle({
        status: 'unsupported',
        endpointTransport: 'lan',
      } as Parameters<typeof joinDialogActionTitle>[0])
    ).toBe('lan storage unavailable');
  });
});