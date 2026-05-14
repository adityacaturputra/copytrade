# Client Dashboard (Next.js)

This directory contains the Next.js frontend application for CopyTrade.

## Structure

- **`page.tsx`**: The main dashboard page. Currently a monolithic file that handles tab routing (Drafts, Positions, Signals, Logs), state management, and polling.
- **`settings/page.tsx`**: Configuration page for risk management, cron schedules, and exchange API keys.
- **`agent/page.tsx`**: The conversational UI for interacting with the backend AI Agent.
- **`api/`**: Next.js App Router API routes. Many of these act as proxies to the backend Express server or interact directly with the `shared` database models.
- **`_components/`**: (Future) Shared React components to be extracted from `page.tsx`.

## Key Concepts

- **Authentication**: `action-auth-context.tsx` manages a client-side "action password" required to execute sensitive operations (like accepting a draft or modifying settings).
- **Data Fetching**: The dashboard polls the `/api/dashboard` endpoint to get realtime updates on positions, drafts, and system stats.
- **Trading Mode**: Users can toggle between "Auto Mode" and "Manual Mode" directly from the dashboard header.

## Refactoring Note
The `page.tsx` and `settings/page.tsx` files are currently monolithic and very large (>3000 lines). When modifying the UI, consider extracting new or existing components into separate files within a `_components` directory to improve maintainability and reduce AI token consumption.
