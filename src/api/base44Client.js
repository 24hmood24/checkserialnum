// Local stub to replace external Base44 SDK client.
// This keeps the same surface shape used by the app (`functions`, `entities`,
// `integrations`, `auth`) but implements simple in-memory/localStorage
// backed behavior so the site can operate without the Base44 platform.
export const base44 = {
  functions: {},
  entities: {},
  integrations: {},
  auth: {},
};
