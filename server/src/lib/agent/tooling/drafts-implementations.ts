import { connectDB, getPendingDrafts } from "@copytrade/shared/lib/database/index";
import type { ToolExecutor } from "./shared";
import {
  getErrorMessage,
  getFrontendBaseUrl,
} from "./shared";

export const draftsToolImplementations: Record<string, ToolExecutor> = {
  get_pending_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    return JSON.stringify(
      drafts.map((d) => ({
        _id: d._id,
        action: d.action,
        symbol: d.symbol,
        side: d.side,
        entryPrice: d.entryPrice,
        takeProfitTargets: d.takeProfitTargets,
        stopLoss: d.stopLoss,
        leverage: d.leverage,
        quantity: d.quantity,
        confidence: d.confidence,
        reasoning: d.reasoning,
        author: d.author,
        status: d.status,
        originalContent: d.originalContent,
        createdAt: d.createdAt,
      })),
    );
  },

  accept_draft: async (args) => {
    const { draftId } = args as { draftId: string };

    if (!/^[0-9a-fA-F]{24}$/.test(draftId)) {
      return JSON.stringify({
        success: false,
        error: `Invalid draft ID '${draftId}'. You MUST use the exact _id string from get_pending_drafts (24-char hex string like '6810a1b2c3d4e5f6a7b8c9d0'). Call get_pending_drafts first to get the correct IDs.`,
      });
    }

    const baseUrl = getFrontendBaseUrl();
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/accept`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  reject_draft: async (args) => {
    const { draftId } = args as { draftId: string };

    if (!/^[0-9a-fA-F]{24}$/.test(draftId)) {
      return JSON.stringify({
        success: false,
        error: `Invalid draft ID '${draftId}'. You MUST use the exact _id string from get_pending_drafts (24-char hex string like '6810a1b2c3d4e5f6a7b8c9d0'). Call get_pending_drafts first to get the correct IDs.`,
      });
    }

    const baseUrl = getFrontendBaseUrl();
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/reject`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  accept_all_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    if (drafts.length === 0) {
      return JSON.stringify({
        success: true,
        message: "No pending drafts to accept.",
        accepted: 0,
      });
    }

    const baseUrl = getFrontendBaseUrl();
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const draft of drafts) {
      try {
        const res = await fetch(`${baseUrl}/api/drafts/${draft._id}/accept`, {
          method: "POST",
        });
        const data = await res.json();
        results.push({
          id: String(draft._id),
          success: res.ok,
          error: getErrorMessage(data),
        });
      } catch (err) {
        results.push({
          id: String(draft._id),
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return JSON.stringify({
      success: true,
      total: drafts.length,
      accepted: succeeded,
      failed,
      results,
    });
  },

  reject_all_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    if (drafts.length === 0) {
      return JSON.stringify({
        success: true,
        message: "No pending drafts to reject.",
        rejected: 0,
      });
    }

    const baseUrl = getFrontendBaseUrl();
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const draft of drafts) {
      try {
        const res = await fetch(`${baseUrl}/api/drafts/${draft._id}/reject`, {
          method: "POST",
        });
        const data = await res.json();
        results.push({
          id: String(draft._id),
          success: res.ok,
          error: getErrorMessage(data),
        });
      } catch (err) {
        results.push({
          id: String(draft._id),
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return JSON.stringify({
      success: true,
      total: drafts.length,
      rejected: succeeded,
      failed,
      results,
    });
  },
};
