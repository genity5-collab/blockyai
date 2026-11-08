import React, { createContext, useContext } from "react";
const Ctx = createContext(null);
export const TokensProvider = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useTokensCtx = () => useContext(Ctx) ?? { status: null, claiming: false, claim() {}, refresh() {}, viewScreenshot: async () => ({ error: "unavailable" }) };
