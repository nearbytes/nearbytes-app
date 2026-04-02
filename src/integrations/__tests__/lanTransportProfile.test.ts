import { describe, expect, it } from 'vitest';
import {
  LAN_DISCOVERY_PROTOCOL_VERSION,
  LAN_QUIC_ALPN,
  LAN_TXT_MAX_RECOMMENDED_BYTES,
  buildLanDiscoveryTxtRecord,
  estimateLanTxtRecordBytes,
  parseLanDiscoveryTxtRecord,
} from '../lanTransportProfile.js';

describe('lanTransportProfile', () => {
  it('builds a canonical dns-sd txt record for the Nearbytes LAN transport', () => {
    const txt = buildLanDiscoveryTxtRecord({
      peerId: 'peer-123',
      headSequence: 42,
      capabilities: ['inventory-recovery', 'quic', 'quic', 'push-hint'],
    });

    expect(txt).toEqual({
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: 'peer-123',
      alpn: LAN_QUIC_ALPN,
      caps: 'inventory-recovery,push-hint,quic',
      head: '42',
    });
  });

  it('parses a valid dns-sd txt record into a strongly typed profile', () => {
    const parsed = parseLanDiscoveryTxtRecord({
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: 'peer-abc',
      alpn: LAN_QUIC_ALPN,
      caps: 'quic,inventory-recovery,quic',
      head: '17',
    });

    expect(parsed).toEqual({
      protocolVersion: LAN_DISCOVERY_PROTOCOL_VERSION,
      peerId: 'peer-abc',
      alpn: LAN_QUIC_ALPN,
      capabilities: ['inventory-recovery', 'quic'],
      headSequence: 17,
    });
  });

  it('keeps the recommended dns-sd txt record small', () => {
    const txt = buildLanDiscoveryTxtRecord({
      peerId: 'desktop-lan-peer-123456',
      headSequence: 999999,
      capabilities: ['quic', 'observation-log', 'inventory-recovery', 'push-hint'],
    });

    expect(estimateLanTxtRecordBytes({ ...txt })).toBeLessThanOrEqual(LAN_TXT_MAX_RECOMMENDED_BYTES);
  });

  it('rejects malformed txt records', () => {
    expect(parseLanDiscoveryTxtRecord({})).toBeNull();
    expect(parseLanDiscoveryTxtRecord({ pv: '0.3', peer: '', alpn: 'nearbytes-lan/0.3', caps: 'quic' })).toBeNull();
  });
});
