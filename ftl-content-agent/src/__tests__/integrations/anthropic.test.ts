import { describe, expect, it } from '@jest/globals';
import { modelSupportsSamplingParams } from '../../integrations/anthropic.js';

describe('modelSupportsSamplingParams', () => {
  it('allows temperature on Sonnet 4.6 and earlier Opus', () => {
    expect(modelSupportsSamplingParams('claude-sonnet-4-6')).toBe(true); // pragma: allowlist secret
    expect(modelSupportsSamplingParams('claude-opus-4-6')).toBe(true); // pragma: allowlist secret
    expect(modelSupportsSamplingParams('claude-haiku-4-5-20251001')).toBe(true);
  });

  it('blocks temperature on Opus 4.7+', () => {
    expect(modelSupportsSamplingParams('claude-opus-4-7')).toBe(false); // pragma: allowlist secret
    expect(modelSupportsSamplingParams('claude-opus-4-8')).toBe(false); // pragma: allowlist secret
    expect(modelSupportsSamplingParams('claude-opus-4-7-20260219')).toBe(false); // pragma: allowlist secret
  });
});
