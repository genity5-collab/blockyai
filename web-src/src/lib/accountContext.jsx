import React, { createContext, useContext } from "react";
// The Discord account is loaded ONCE (in App) and shared, so the corner button, the topbar and the sign-in gate always agree.
const Ctx = createContext(null);
export const AccountProvider = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useAccountCtx = () => useContext(Ctx) ?? { acct: null, busy: false, signIn() {}, signOut() {}, loginResult: null };
