import { describe, expect, it } from 'vitest';
import {
  LAN_DISCOVERY_PROTOCOL_VERSION,
  LAN_TRANSPORT_PROFILE_ID,
  LAN_TXT_MAX_RECOMMENDED_BYTES,
  buildLanDiscoveryTxtRecord,
  estimateLanTxtRecordBytes,
  parseLanDiscoveryTxtRecord,
} from '../lanTransportProfile.js';

describe('lanTransportProfile', () => {
  it('builds a canonical dns-sd txt record for the Nearbytes LAN transport', () => {
    const txt = buildLanDiscoveryTxtRecord({
      peerId: 'peer-123',
      headObservationId: 'ab'.repeat(32),
      capabilities: ['inventory-recovery', 'webrtc', 'webrtc', 'push-hint'],
      signalAddress: '192.168.8.165',
    });

    expect(txt).toEqual({
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: 'peer-123',
      alpn: LAN_TRANSPORT_PROFILE_ID,
      addr: '192.168.8.165',
      caps: 'inventory-recovery,push-hint,webrtc',
      head: 'ab'.repeat(32),
    });
  });

  it('parses a valid dns-sd txt record into a strongly typed profile', () => {
    const parsed = parseLanDiscoveryTxtRecord({
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: 'peer-abc',
      alpn: LAN_TRANSPORT_PROFILE_ID,
      caps: 'webrtc,inventory-recovery,webrtc',
      head: 'cd'.repeat(32),
    });

    expect(parsed).toEqual({
      protocolVersion: LAN_DISCOVERY_PROTOCOL_VERSION,
      peerId: 'peer-abc',
      alpn: LAN_TRANSPORT_PROFILE_ID,
      capabilities: ['inventory-recovery', 'webrtc'],
      headObservationId: 'cd'.repeat(32),
      signalAddress: null,
    });
  });

  it('parses an explicit signal address from the discovery txt record', () => {
    const parsed = parseLanDiscoveryTxtRecord({
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: 'peer-abc',
      alpn: LAN_TRANSPORT_PROFILE_ID,
      caps: 'webrtc,inventory-recovery',
      addr: '192.168.8.165',
    });

    expect(parsed?.signalAddress).toBe('192.168.8.165');
  });

  it('keeps the recommended dns-sd txt record small', () => {
    const txt = buildLanDiscoveryTxtRecord({
      peerId: 'desktop-lan-peer-123456',
      headObservationId: 'ef'.repeat(32),
      capabilities: ['webrtc', 'observation-log', 'inventory-recovery', 'push-hint'],
    });

    expect(estimateLanTxtRecordBytes({ ...txt })).toBeLessThanOrEqual(LAN_TXT_MAX_RECOMMENDED_BYTES);
  });

  it('rejects malformed txt records', () => {
    expect(parseLanDiscoveryTxtRecord({})).toBeNull();
    expect(parseLanDiscoveryTxtRecord({ pv: '0.3', peer: '', alpn: 'nearbytes-lan/0.3', caps: 'webrtc' })).toBeNull();
  });
});
