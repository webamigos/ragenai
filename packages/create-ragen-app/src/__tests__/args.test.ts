import { describe, expect, it } from 'vitest';

import { parseArgs } from '../args';

describe('parseArgs', () => {
  it('leaves targetDir undefined when no positional argument is given', () => {
    expect(parseArgs([]).targetDir).toBeUndefined();
  });

  it('reads the positional argument as targetDir', () => {
    expect(parseArgs(['./my-ragen']).targetDir).toBe('./my-ragen');
  });

  it('defaults ref to main', () => {
    expect(parseArgs([]).ref).toBe('main');
  });

  it('reads --ref=<value>', () => {
    expect(parseArgs(['--ref=v1.2.0']).ref).toBe('v1.2.0');
  });

  it('reads a full commit SHA as a ref, which is what CI passes', () => {
    // The installer workflow scaffolds from the commit rather than the branch
    // name, because the branch can be deleted by the merge while the job runs.
    const sha = 'f35087e92600d4e1f8de7e9b149fac27d8be0007';
    expect(parseArgs([`--ref=${sha}`]).ref).toBe(sha);
  });

  it('defaults every flag to false', () => {
    const args = parseArgs([]);
    expect(args.skipDocker).toBe(false);
    expect(args.skipInstall).toBe(false);
    expect(args.yes).toBe(false);
  });

  it('reads --skip-docker, --skip-install and --yes', () => {
    const args = parseArgs([
      'my-app',
      '--skip-docker',
      '--skip-install',
      '--yes',
    ]);
    expect(args.targetDir).toBe('my-app');
    expect(args.skipDocker).toBe(true);
    expect(args.skipInstall).toBe(true);
    expect(args.yes).toBe(true);
  });

  it('rejects a second positional argument instead of silently taking it as targetDir', () => {
    // e.g. a user typing `--ref main` (space-separated) by habit — every
    // flag here requires `--name=value`, so `main` must not become targetDir.
    expect(() => parseArgs(['my-app', '--ref', 'main'])).toThrow(
      /Unexpected extra arguments: main/,
    );
  });

  it('falls back to the default ref when --ref= is given with no value', () => {
    expect(parseArgs(['--ref=']).ref).toBe('main');
  });

  it('accepts a provider, so a key can come from the environment', () => {
    expect(parseArgs(['app', '--provider=openai']).provider).toBe('openai');
    expect(parseArgs(['app', '--provider=anthropic']).provider).toBe(
      'anthropic',
    );
  });

  it('leaves provider undefined when the flag is absent, so the CLI asks', () => {
    expect(parseArgs(['app']).provider).toBeUndefined();
  });

  it('rejects an unknown provider instead of falling back to asking', () => {
    // In CI there is nobody to answer the prompt a silent fallback would
    // reach, so a typo would hang the job rather than fail it.
    expect(() => parseArgs(['app', '--provider=openai-ish'])).toThrow(
      /Unknown --provider/,
    );
  });
});
