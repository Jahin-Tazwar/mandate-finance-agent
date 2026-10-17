import { z } from "zod";
import { Persona } from "./entities";

export const DemoAccount = z.object({
  personaId: z.string(),
  name: z.string(),
  profile: z.string(),
  username: z.string(),
  password: z.string(),
  pin: z.string(),
});

export const LoginRequest = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const AuthMeResponse = z.object({
  persona: Persona,
});

export type DemoAccount = z.infer<typeof DemoAccount>;
export type LoginRequest = z.infer<typeof LoginRequest>;
export type AuthMeResponse = z.infer<typeof AuthMeResponse>;
