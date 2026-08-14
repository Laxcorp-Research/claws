import { describe, it, expect } from 'vitest';
import { AI_MODELS, DEFAULT_MODEL, getModelLabel, getModelCost } from '@/lib/models';
import { PINNED_SEED_MODELS } from '@/lib/models/seed-models';

describe('AI_MODELS', () => {
  it('contains expected number of models', () => {
    expect(AI_MODELS.length).toBeGreaterThanOrEqual(6);
  });

  it('every model has required fields', () => {
    for (const m of AI_MODELS) {
      expect(m.value).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(m.tier).toBeTruthy();
      expect(typeof m.costPer1kCalls).toBe('number');
    }
  });

  it('is derived from PINNED_SEED_MODELS natives (single source)', () => {
    expect(AI_MODELS.map((m) => m.value)).toEqual(
      PINNED_SEED_MODELS.filter((m) => m.provider !== 'OPENROUTER').map((m) => m.modelId),
    );
  });
});

describe('DEFAULT_MODEL', () => {
  it('maps ORCHESTRATOR to haiku', () => {
    expect(DEFAULT_MODEL.ORCHESTRATOR).toContain('haiku');
  });

  it('maps WORKER to sonnet', () => {
    expect(DEFAULT_MODEL.WORKER).toContain('sonnet');
  });

  it('maps CRITIC to opus', () => {
    expect(DEFAULT_MODEL.CRITIC).toContain('opus');
  });
});

describe('getModelLabel', () => {
  it('returns label for known model', () => {
    expect(getModelLabel('anthropic/claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
  });

  it('returns value as fallback for unknown model', () => {
    expect(getModelLabel('unknown/model-123')).toBe('unknown/model-123');
  });
});

describe('getModelCost', () => {
  it('returns cost for known model', () => {
    expect(getModelCost('anthropic/claude-haiku-4-5-20251001')).toBe(0.001);
  });

  it('returns 0.015 default for unknown model', () => {
    expect(getModelCost('unknown/model')).toBe(0.015);
  });
});
