import { describe, expect, it } from 'vitest';
import { buildFileManagerLaunchPlan } from '../fileManager.js';

describe('buildFileManagerLaunchPlan', () => {
  it('quotes Windows file selection paths for Explorer', () => {
    const plan = buildFileManagerLaunchPlan(
      'C:\\Users\\Alice\\Nearbytes Data\\channels\\event.bin',
      'C:\\Users\\Alice\\Nearbytes Data\\channels',
      'file',
      'win32'
    );

    expect(plan).toEqual({
      command: 'explorer.exe',
      args: ['/select,', 'C:\\Users\\Alice\\Nearbytes Data\\channels\\event.bin'],
    });
  });

  it('opens Windows directories directly when there is nothing to select', () => {
    const plan = buildFileManagerLaunchPlan(
      'C:\\Users\\Alice\\Nearbytes Data\\channels',
      'C:\\Users\\Alice\\Nearbytes Data\\channels',
      'directory',
      'win32'
    );

    expect(plan).toEqual({
      command: 'explorer.exe',
      args: ['C:\\Users\\Alice\\Nearbytes Data\\channels'],
    });
  });
});