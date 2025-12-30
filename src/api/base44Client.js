import { createClient } from '@base44/sdk';
// import { getAccessToken } from '@base44/sdk/utils/auth-utils';

// Create a client with authentication required
export const base44 = createClient({
  appId: "68be8a0a3b67255d3609ea18", 
  requiresAuth: true // Ensure authentication is required for all operations
});
