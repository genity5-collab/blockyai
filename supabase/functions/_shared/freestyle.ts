// Thin Freestyle SDK wrapper. FREESTYLE_API_KEY lives ONLY in Supabase secrets.
import { Freestyle } from "npm:freestyle@latest";
export const fs = () => new Freestyle({ apiKey: Deno.env.get("FREESTYLE_API_KEY")! });
export const MAX_LIFETIME_S = 4 * 3600;   // hard cap per VM
export const IDLE_SUSPEND_MIN = 10;       // suspend after N min idle
