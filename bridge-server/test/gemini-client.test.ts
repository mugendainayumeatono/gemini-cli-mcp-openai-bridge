import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiApiClient } from '../src/gemini-client.js';
import { Config, AuthType, DEFAULT_GEMINI_FLASH_MODEL } from '@google/gemini-cli-core';

// We keep the logger mocked to avoid cluttering test output, 
// but we use real core classes as requested.
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('GeminiApiClient (Integration)', () => {
  let config: Config;

  beforeEach(async () => {
    config = new Config({
      sessionId: 'test-session-' + Math.random().toString(16).slice(2),
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: DEFAULT_GEMINI_FLASH_MODEL,
      debugMode: false,
    });

    await config.initialize();
    // Use LOGIN_WITH_GOOGLE as it was proven to work in the environment.
    // In CI or other environments, GEMINI_API_KEY might be preferred, 
    // but the bridge server index.ts handles both.
    // For these tests, we'll try to use whatever the environment provides.
    try {
      await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
    } catch (e) {
      // If LOGIN_WITH_GOOGLE fails, try USE_GEMINI as fallback.
      await config.refreshAuth(AuthType.USE_GEMINI);
    }
  });

  it('should send a message stream and yield chunks', async () => {
    const client = new GeminiApiClient(config, false);
    const messages = [
      { role: 'user', content: 'Say "Test Success" and nothing else.' }
    ];

    const stream = await client.sendMessageStream({
      model: DEFAULT_GEMINI_FLASH_MODEL,
      messages: messages as any,
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'text') {
        fullText += chunk.data;
      }
    }

    expect(fullText.toLowerCase()).toContain('test success');
  }, 30000); // Increased timeout for real API call

  it('should handle tool calls in the stream', async () => {
    const client = new GeminiApiClient(config, false);
    const messages = [
      { role: 'user', content: 'Call the get_weather tool for London.' }
    ];

    // Note: We need to provide tool definitions for the model to actually call them.
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather in a given location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            },
            required: ['location']
          }
        }
      }
    ];

    const stream = await client.sendMessageStream({
      model: DEFAULT_GEMINI_FLASH_MODEL,
      messages: messages as any,
      tools: tools as any,
    });

    const toolCalls = [];
    for await (const chunk of stream) {
      if (chunk.type === 'tool_code') {
        toolCalls.push(chunk.data);
      }
    }

    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0].name).toBe('get_weather');
    expect(toolCalls[0].args).toHaveProperty('location');
    expect(toolCalls[0].args.location.toLowerCase()).toContain('london');
  }, 30000);
});
