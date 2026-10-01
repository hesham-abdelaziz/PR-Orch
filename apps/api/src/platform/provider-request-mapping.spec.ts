import { describe, expect, it } from 'vitest';
import {
  ModelSelection,
  ReasoningEffort,
  assertModelSelectionSupported,
  ModelCatalogEntry,
} from '@pr-orchestrator/contracts';
import {
  assertCommandPolicy,
  buildClaudeReviewArgs,
  buildCodexReviewArgs,
} from '../providers/adapters/adapter-command-policy.js';

/**
 * Pure request mapping helpers matching the backend provider wiring specification
 * for per-model reasoning effort.
 */
export function mapCodexArgsWithEffort(input: {
  model: string;
  schemaPath: string;
  workspacePath: string;
  effort?: ReasoningEffort;
}): string[] {
  const baseArgs = buildCodexReviewArgs(input);
  if (!input.effort || input.effort === 'default') {
    return baseArgs;
  }
  // Insert `-c model_reasoning_effort="<level>"` right before '-'
  const stdinIdx = baseArgs.indexOf('-');
  const effortArgs = ['-c', `model_reasoning_effort="${input.effort}"`];
  if (stdinIdx === -1) {
    return [...baseArgs, ...effortArgs];
  }
  return [...baseArgs.slice(0, stdinIdx), ...effortArgs, ...baseArgs.slice(stdinIdx)];
}

export function mapClaudeArgsWithEffort(input: {
  model: string;
  schemaJson: string;
  readOnlyDirectories?: readonly string[];
  effort?: ReasoningEffort;
}): string[] {
  const baseArgs = buildClaudeReviewArgs(input);
  if (!input.effort || input.effort === 'default') {
    return baseArgs;
  }
  return [...baseArgs, '--effort', input.effort];
}

export function mapGeminiSettingsOverlay(input: {
  effort?: ReasoningEffort;
  model: string;
}): { thinking?: { level: string } } | null {
  if (!input.effort || input.effort === 'default') {
    return null;
  }
  return {
    thinking: {
      level: input.effort,
    },
  };
}

describe('provider-native request mapping for reasoning effort', () => {
  const sampleSchemaPath = 'C:/temp/schema.json';
  const sampleWorkspacePath = 'C:/temp/workspace';
  const dummyPrompt = 'Analyze the pull request changes for safety issues.';

  describe('Codex reasoning effort mapping', () => {
    it('omits config override when effort is default or undefined', () => {
      const argsWithoutEffort = mapCodexArgsWithEffort({
        model: 'o3',
        schemaPath: sampleSchemaPath,
        workspacePath: sampleWorkspacePath,
      });
      expect(argsWithoutEffort).not.toContain('-c');
      expect(argsWithoutEffort.some((a) => a.includes('model_reasoning_effort'))).toBe(false);
      expect(() => assertCommandPolicy('codex', argsWithoutEffort, dummyPrompt)).not.toThrow();

      const argsWithDefault = mapCodexArgsWithEffort({
        model: 'o3',
        schemaPath: sampleSchemaPath,
        workspacePath: sampleWorkspacePath,
        effort: 'default',
      });
      expect(argsWithDefault).toEqual(argsWithoutEffort);
    });

    it('injects model_reasoning_effort config and preserves all read-only restrictions', () => {
      const args = mapCodexArgsWithEffort({
        model: 'o3',
        schemaPath: sampleSchemaPath,
        workspacePath: sampleWorkspacePath,
        effort: 'high',
      });

      expect(args).toContain('-c');
      expect(args).toContain('model_reasoning_effort="high"');
      // '-' (stdin prompt) must be at the very end
      expect(args[args.length - 1]).toBe('-');

      // Verifies all required security controls are preserved
      expect(args).toContain('--sandbox');
      expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
      expect(args).toContain('--ask-for-approval');
      expect(args[args.indexOf('--ask-for-approval') + 1]).toBe('never');
      expect(args).toContain('--ephemeral');
      expect(() => assertCommandPolicy('codex', args, dummyPrompt)).not.toThrow();
    });
  });

  describe('Claude reasoning effort mapping', () => {
    it('omits --effort when effort is default or undefined', () => {
      const argsWithoutEffort = mapClaudeArgsWithEffort({
        model: 'sonnet',
        schemaJson: '{}',
      });
      expect(argsWithoutEffort).not.toContain('--effort');
      expect(() => assertCommandPolicy('claude', argsWithoutEffort, dummyPrompt)).not.toThrow();

      const argsWithDefault = mapClaudeArgsWithEffort({
        model: 'sonnet',
        schemaJson: '{}',
        effort: 'default',
      });
      expect(argsWithDefault).toEqual(argsWithoutEffort);
    });

    it('appends --effort flag with level and preserves plan and restricted modes', () => {
      const args = mapClaudeArgsWithEffort({
        model: 'sonnet',
        schemaJson: '{}',
        effort: 'medium',
      });

      expect(args).toContain('--effort');
      expect(args[args.indexOf('--effort') + 1]).toBe('medium');

      // Verifies all required security controls are preserved
      expect(args).toContain('-p');
      expect(args).toContain('--restricted');
      expect(args).toContain('--no-session-persistence');
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
      expect(() => assertCommandPolicy('claude', args, dummyPrompt)).not.toThrow();
    });
  });

  describe('Gemini thinking configuration overlay', () => {
    it('returns null overlay when effort is default or undefined', () => {
      expect(mapGeminiSettingsOverlay({ model: 'pro' })).toBeNull();
      expect(mapGeminiSettingsOverlay({ model: 'pro', effort: 'default' })).toBeNull();
    });

    it('creates isolated thinking configuration when explicit effort is selected', () => {
      const overlay = mapGeminiSettingsOverlay({ model: 'pro', effort: 'low' });
      expect(overlay).toEqual({
        thinking: {
          level: 'low',
        },
      });
    });
  });

  describe('independent selections and capability filtering across multi-model runs', () => {
    it('maps main verifier and each reviewer independently', () => {
      const mainSelection: ModelSelection = { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' };
      const reviewer1: ModelSelection = { provider: 'codex', model: 'o3', reasoningEffort: 'low' };
      const reviewer2: ModelSelection = { provider: 'claude', model: 'haiku', reasoningEffort: 'default' };

      const mainArgs = mapClaudeArgsWithEffort({
        model: mainSelection.model,
        schemaJson: '{}',
        effort: mainSelection.reasoningEffort,
      });
      const rev1Args = mapCodexArgsWithEffort({
        model: reviewer1.model,
        schemaPath: sampleSchemaPath,
        workspacePath: sampleWorkspacePath,
        effort: reviewer1.reasoningEffort,
      });
      const rev2Args = mapClaudeArgsWithEffort({
        model: reviewer2.model,
        schemaJson: '{}',
        effort: reviewer2.reasoningEffort,
      });

      expect(mainArgs).toContain('--effort');
      expect(mainArgs[mainArgs.indexOf('--effort') + 1]).toBe('high');

      expect(rev1Args).toContain('model_reasoning_effort="low"');

      expect(rev2Args).not.toContain('--effort');
    });

    it('rejects unsupported reasoning effort before process execution', () => {
      const catalog: ModelCatalogEntry[] = [
        {
          id: 'o3',
          label: 'OpenAI o3',
          available: true,
          supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
        {
          id: 'cli-default',
          label: 'CLI default',
          available: true,
          // No supportedReasoningEfforts metadata -> permits Default only
        },
      ];

      // o3 supports high
      expect(() =>
        assertModelSelectionSupported({ provider: 'codex', model: 'o3', reasoningEffort: 'high' }, catalog),
      ).not.toThrow();

      // cli-default does not support explicit high
      expect(() =>
        assertModelSelectionSupported(
          { provider: 'codex', model: 'cli-default', reasoningEffort: 'high' },
          catalog,
        ),
      ).toThrowError(/Reasoning effort "high" is not supported/);
    });
  });
});
