import program from 'commander';
import { vol } from 'memfs';

import { mockExpoXDL } from '../../__tests__/mock-utils';
import { jester } from '../../credentials/__tests__/fixtures/mocks-constants';
import log from '../../log';
import { collectMergeSourceUrlsAsync, ensurePublicUrlAsync, promptPublicUrlAsync } from '../export';

jest.mock('fs');
jest.mock('resolve-from');
jest.mock('@expo/image-utils', () => ({
  generateImageAsync(input, { src }) {
    const fs = require('fs');
    return { source: fs.readFileSync(src) };
  },
}));
jest.mock('../utils/Tar', () => ({
  async downloadAndDecompressAsync(url: string, destination: string): Promise<string> {
    return destination;
  },
}));

mockExpoXDL({
  UserManager: {
    ensureLoggedInAsync: jest.fn(() => jester),
    getCurrentUserAsync: jest.fn(() => jester),
  },
  ApiV2: {
    clientForUser: jest.fn(),
  },
});

it(`throws a coded error when prompted in non interactive`, async () => {
  program.nonInteractive = true;
  await expect(promptPublicUrlAsync()).rejects.toThrow('public-url');
});

describe('ensurePublicUrlAsync', () => {
  it(`throws when a URL is not HTTPS in prod`, async () => {
    await expect(ensurePublicUrlAsync('bacon', false)).rejects.toThrow('must be a valid HTTPS URL');
    await expect(ensurePublicUrlAsync('ssh://bacon.io', false)).rejects.toThrow(
      'must be a valid HTTPS URL'
    );
  });
  it(`does not throw when an invalid URL is used in dev mode`, async () => {
    const logWarnSpy = jest.spyOn(log, 'nestedWarn').mockImplementation(() => {});

    await expect(ensurePublicUrlAsync('bacon', true)).resolves.toBe('bacon');
    await expect(ensurePublicUrlAsync('ssh://bacon.io', true)).resolves.toBe('ssh://bacon.io');
    // Ensure we warn about the invalid URL in dev mode.
    expect(logWarnSpy).toBeCalledTimes(2);

    logWarnSpy.mockReset();
  });

  it(`validates a URL`, async () => {
    const logWarnSpy = jest.spyOn(log, 'nestedWarn').mockImplementation(() => {});

    await expect(ensurePublicUrlAsync('https://expo.io', true)).resolves.toBe('https://expo.io');
    // No warnings thrown
    expect(logWarnSpy).toBeCalledTimes(0);

    logWarnSpy.mockReset();
  });
});

describe('collectMergeSourceUrlsAsync', () => {
  const projectRoot = '/alpha';

  beforeAll(() => {
    vol.fromJSON({});
  });

  afterAll(() => {
    vol.reset();
  });

  it(`downloads tar files`, async () => {
    const directories = await collectMergeSourceUrlsAsync(projectRoot, ['expo.io/app.tar.gz']);
    expect(directories.length).toBe(1);
    // Ensure the file was downloaded with the expected name
    expect(directories[0]).toMatch(/\/alpha\/\.tmp\/app_/);

    // Ensure the tmp directory was created and the file was added
    expect(vol.existsSync(directories[0])).toBe(true);
  });
});
