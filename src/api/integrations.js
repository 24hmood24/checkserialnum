import { base44 } from './base44Client';

// Minimal integration stubs so the rest of the app can import these names.
// These functions can be expanded later to call real external services.
export const Core = {};

export const InvokeLLM = async (..._args) => ({ data: null, error: 'not_available' });
export const SendEmail = async (..._args) => ({ data: null, error: 'not_available' });
export const UploadFile = async (..._args) => ({ data: null, error: 'not_available' });
export const GenerateImage = async (..._args) => ({ data: null, error: 'not_available' });
export const ExtractDataFromUploadedFile = async (..._args) => ({ data: null, error: 'not_available' });
export const CreateFileSignedUrl = async (..._args) => ({ data: null, error: 'not_available' });
export const UploadPrivateFile = async (..._args) => ({ data: null, error: 'not_available' });






