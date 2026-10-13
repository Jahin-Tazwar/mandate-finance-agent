// Shared "contracts": the shapes of data that both the API and the web app use.
// Each Zod schema gives us two things at once:
//   1. a runtime check (Schema.parse(data) throws if data is the wrong shape)
//   2. a TypeScript type (z.infer<typeof Schema>) for the editor and compiler
export * from "./entities";
export * from "./policy";
export * from "./wishes";
export * from "./analytics";
