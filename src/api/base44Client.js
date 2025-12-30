import { createClient } from '@base44/sdk';
// import { getAccessToken } from '@base44/sdk/utils/auth-utils';

// Create a client with authentication required
// Make the client optional-auth so the site can render publicly without forcing
// an immediate redirect to the Base44 login. Some API calls will still return
// 401 if they require a logged-in user — handle those responses in the UI.
export const base44 = createClient({
  appId: "68be8a0a3b67255d3609ea18",
  requiresAuth: false
});
