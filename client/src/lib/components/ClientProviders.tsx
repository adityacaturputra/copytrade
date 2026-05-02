"use client";

import React from "react";
import { ActionAuthProvider } from "../action-auth-context";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <ActionAuthProvider>{children}</ActionAuthProvider>;
}
