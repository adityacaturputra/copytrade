const fs = require('fs');

const file = 'server/src/lib/agent/loop.ts';
let content = fs.readFileSync(file, 'utf-8');

// Add new imports
const newImports = `
import { buildSystemPrompt } from "./prompt";
import { resolveProviderConfig, buildAgentProviderChain } from "./providers";
import { 
  cloneMessages, 
  parseToolArgs, 
  buildToolResultMessage, 
  buildAssistantToolCallMessage,
  type AgentChatMessage,
  type PendingToolCall
} from "./message-helpers";
`;

// Find where to insert imports
content = content.replace('import OpenAI from "openai";', 'import OpenAI from "openai";' + newImports);

// Remove extracted code
const toRemove = [
  /const BASE_SYSTEM_PROMPT = `[\s\S]*?`;/m,
  /async function buildSystemPrompt\(role: AgentRole\): Promise<string> {[\s\S]*?\n}/m,
  /function resolveProviderConfig\(provider\?: string\) {[\s\S]*?\n}/m,
  /function parseAgentFallbackProviders\(primary: string\): string\[] {[\s\S]*?\n}/m,
  /function buildAgentProviderChain\(provider\?: string\): string\[] {[\s\S]*?\n}/m,
  /function cloneMessages\(messages: AgentChatMessage\[]\): AgentChatMessage\[] {[\s\S]*?\n}/m,
  /function parseToolArgs\(input: string\): Record<string, unknown> {[\s\S]*?\n}/m,
  /function buildToolResultMessage\([\s\S]*?\n}/m,
  /function buildAssistantToolCallMessage\([\s\S]*?\n}/m,
  /type AgentChatMessage = OpenAI.ChatCompletionMessageParam;/m,
  /type PendingToolCall = {[\s\S]*?};/m
];

for (const regex of toRemove) {
  content = content.replace(regex, '');
}

// Fix any double empty lines
content = content.replace(/\n\n\n+/g, '\n\n');

fs.writeFileSync(file, content);
console.log('Cleaned up loop.ts');
