import { describe, expect, it } from 'vitest';

import {
  __test__,
  formatAccessLevelLabel,
  getCollaboratorDedupeKey,
  getCollaboratorDisplayLabel,
  getCollaboratorRoleLabel,
  getIncomingSharePresentation,
  getManagedShareAccessLabel,
} from './megaSharePresentation.js';

describe('mega share presentation', () => {
  it('formats MEGA access levels for display', () => {
    expect(formatAccessLevelLabel('read')).toBe('Read only');
    expect(formatAccessLevelLabel('read/write')).toBe('Read and write');
    expect(formatAccessLevelLabel('full access')).toBe('Full access');
    expect(formatAccessLevelLabel('owner')).toBe('Owner');
  });

  it('prefers the provider access level for MEGA shares', () => {
    expect(
      getManagedShareAccessLabel({
        share: {
          provider: 'mega',
          capabilities: ['mirror', 'read'],
          remoteDescriptor: { accessLevel: 'full access' },
        },
        storage: { writable: false },
      } as never)
    ).toBe('Full access');
  });

  it('describes writable incoming MEGA shares before acceptance', () => {
    expect(
      getIncomingSharePresentation(
        {
          provider: 'mega',
          remoteDescriptor: { accessLevel: 'read/write' },
        } as never,
        { hasVolumeTarget: false }
      )
    ).toEqual({
      actionLabel: 'Add shared folder',
      metaDetail: 'Saved as a shared folder',
      statusBadge: {
        label: 'Read and write',
        tone: 'good',
      },
    });
  });

  it('keeps readonly MEGA offers labeled as mirrors', () => {
    expect(
      getIncomingSharePresentation(
        {
          provider: 'mega',
          remoteDescriptor: { accessLevel: 'read' },
        } as never,
        { hasVolumeTarget: false }
      )
    ).toEqual({
      actionLabel: 'Add mirror',
      metaDetail: 'Saved as a mirror',
      statusBadge: {
        label: 'Read only',
        tone: 'muted',
      },
    });
  });

  it('renders collaborator labels and roles from provider data', () => {
    expect(getCollaboratorDisplayLabel({ label: 'Owner', email: 'owner@example.com' })).toBe('owner@example.com');
    expect(getCollaboratorDedupeKey({ label: 'Owner', email: 'OWNER@example.com' })).toBe('owner@example.com');
    expect(
      getCollaboratorRoleLabel({
        role: 'read/write',
        status: 'active',
        source: 'provider',
      })
    ).toBe('Read and write');
    expect(
      getCollaboratorRoleLabel({
        status: 'invited',
        source: 'nearbytes',
      } as never)
    ).toBe('Invited');
  });

  it('recognizes writable incoming MEGA access levels', () => {
    expect(__test__.isWritableAccessLevel('read/write')).toBe(true);
    expect(__test__.isWritableAccessLevel('full access')).toBe(true);
    expect(__test__.isWritableAccessLevel('read')).toBe(false);
  });
});