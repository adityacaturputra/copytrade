# AI Agent Subsystem

This directory contains the conversational AI Agent responsible for managing trades, retrieving logs, and interacting with the system autonomously via chat.

## Architecture

The agent is built using a custom tool-calling loop and system prompt, interacting with OpenAI models.

- **`loop.ts`**: The core execution engine. It manages the conversation history, constructs the context prompt, invokes the LLM, and executes any requested tools.
- **`context-manager.ts`**: Prepares the context (current open positions, recent drafts, exchange status) to inject into the AI's prompt.
- **`position-monitor-agent.ts`**: A specialized agent loop dedicated to monitoring and deciding on position adjustments (e.g., trailing stops, closing).
- **`tooling/`**: Contains the definitions and implementations of tools the AI can use.
  - `definitions.ts`: Zod schemas and metadata for all available tools.
  - `position-ops-implementations.ts`: Implementations for modifying positions.
  - `account-market-implementations.ts`: Implementations for checking balances.
  - `trading-implementations.ts`: Implementations for opening trades.
  - `drafts-implementations.ts`: Implementations for managing drafts.

## Adding a New Tool

1. Define the tool schema and description in `tooling/definitions.ts`.
2. Implement the tool's execution logic in the appropriate implementation file (e.g., `tooling/position-ops-implementations.ts`).
3. Register the tool in `loop.ts` so the LLM is aware of it and can invoke it.

## Guidelines
- The `loop.ts` and `position-monitor-agent.ts` files are large. Use line-specific reads when modifying them.
- Ensure all tool executions return a clear, stringified response that the LLM can understand to determine success or failure.
