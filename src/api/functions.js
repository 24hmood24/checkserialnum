import { base44 } from './base44Client';

// Helper to create safe async wrappers around Base44 functions. If the SDK or
// specific function isn't available (e.g., user not authenticated or SDK not
// initialized), these wrappers resolve to a predictable object so callers
// using `const { data } = await fn()` don't throw at runtime.
function safeFn(fnName) {
	return async (...args) => {
		try {
			if (base44 && base44.functions && typeof base44.functions[fnName] === 'function') {
				return await base44.functions[fnName](...args);
			}
			return { data: null, error: 'unauthenticated', status: 401 };
		} catch (err) {
			return { data: null, error: err && err.message ? err.message : String(err) };
		}
	};
}

export const checkDevice = safeFn('checkDevice');
export const findUserByNationalId = safeFn('findUserByNationalId');
export const registerUser = safeFn('registerUser');
export const loginUser = safeFn('loginUser');
export const updateUserProfile = safeFn('updateUserProfile');
export const createNotification = safeFn('createNotification');
export const markNotificationRead = safeFn('markNotificationRead');
export const validateResetRequest = safeFn('validateResetRequest');
export const resetPassword = safeFn('resetPassword');
export const createStolenDeviceReport = safeFn('createStolenDeviceReport');
export const createPurchaseCertificate = safeFn('createPurchaseCertificate');
export const getAdminDashboardData = safeFn('getAdminDashboardData');
export const updateStolenDeviceReport = safeFn('updateStolenDeviceReport');
export const debugUsers = safeFn('debugUsers');
export const debugPasswordCheck = safeFn('debugPasswordCheck');
export const debugResetValidation = safeFn('debugResetValidation');
export const repairMyAccount = safeFn('repairMyAccount');

