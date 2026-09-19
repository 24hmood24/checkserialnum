
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PrivacyPolicyModal from '@/components/PrivacyPolicyModal';
import { UserCog, Lock, User, Phone, IdCard, Key, UserPlus, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { startRegistration, confirmAction, resendAction } from '@/api/functions';
import { OtpCodesForm } from '@/components/OtpDialog';
import { loginUser } from '@/api/functions';
import { requestResetOtp } from '@/api/functions';
import { resetPassword } from '@/api/functions';

export default function UserLoginModal({ isOpen, onLoginSuccess, t, initialMode = 'login', onClose, lang = 'ar' }) {
    const [mode, setMode] = useState('login'); // 'login', 'register', 'reset', 'set_new_password'
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Login form
    const [loginId, setLoginId] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    // Register form
    const [registerId, setRegisterId] = useState('');
    const [registerName, setRegisterName] = useState('');
    const [registerPhone, setRegisterPhone] = useState('');
    const [registerPassword, setRegisterPassword] = useState('');
    const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
    const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
    const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
    // pending registration (waiting for the WhatsApp code)
    const [regOtp, setRegOtp] = useState(null);

    // Reset password form
    const [resetId, setResetId] = useState('');
    const [resetPhone, setResetPhone] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpMinutes, setOtpMinutes] = useState(5);
    const [resendSeconds, setResendSeconds] = useState(0);
    const [info, setInfo] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');

    // Password visibility states
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);
    const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);


    // Helper functions for number handling
    const enforceNumeric = (value) => {
        return value.replace(/\D/g, '');
    };

    const enforceAlphabetic = (value) => {
        // Allow spaces and Arabic letters
        return value.replace(/[^a-zA-Z\u0600-\u06FF\s]/g, '');
    };

    const normalizeNumbers = (value) => {
        const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        return value.split('').map(char => {
            const index = arabicNumerals.indexOf(char);
            return index > -1 ? String(index) : char;
        }).join('');
    };

    const normalizePhoneNumber = (phone) => {
        // Combines enforceNumeric and normalizeNumbers for a complete phone number normalization
        return normalizeNumbers(enforceNumeric(phone));
    };

    const validatePassword = (password) => {
        if (password.length < 8) return false;
        if (!/\d/.test(password)) return false;
        if (!/[a-zA-Z]/.test(password)) return false;
        return true;
    };

    // Auto-detect ID type from number
    const detectIdType = (idNumber) => {
        if (!idNumber || idNumber.length !== 10) return null;
        const firstDigit = idNumber.charAt(0);
        if (firstDigit === '1') return 'national_id';
        if (firstDigit === '2') return 'resident_id';
        if (firstDigit === '3' || firstDigit === '7') return 'commercial_reg';
        return null;
    };

    const resetForms = () => {
        setLoginId('');
        setLoginPassword('');
        setRegisterId('');
        setRegisterName('');
        setRegisterPhone('');
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        setAgreedToPrivacy(false);
        setShowPrivacyPolicy(false);
        setRegOtp(null);
        setResetId('');
        setResetPhone('');
        setNewPassword('');
        setOtpCode('');
        setResendSeconds(0);
        setInfo('');
        setConfirmNewPassword('');
        setError('');
        setShowLoginPassword(false);
        setShowRegisterPassword(false);
        setShowRegisterConfirmPassword(false);
        setShowNewPassword(false);
        setShowConfirmNewPassword(false);
    };

    const handleClose = () => {
        setError('');
        setMode('login');
        onClose();
        resetForms();
    };

    useEffect(() => {
        if (isOpen) {
            setMode(initialMode);
            resetForms();
        }
    }, [isOpen, initialMode]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const identifier = normalizeNumbers(loginId);
            
            const { data: user, error: loginError } = await loginUser({
                nationalId: identifier,
                password: loginPassword
            });

            if (loginError) {
                setError(t('loginError'));
                setLoading(false);
                return;
            }

            if (user) {
                // تحديد نوع المستخدم بناءً على user_type في قاعدة البيانات
                const userType = user.user_type === 'admin' ? 'admin' : 'regular';
                onLoginSuccess(userType, user);
                handleClose();
            } else {
                setError(t('loginError'));
            }

        } catch (error) {
            console.error("Login error:", error);
            setError(t('loginError'));
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const nationalId = normalizeNumbers(registerId);
        const phoneNumber = normalizeNumbers(registerPhone);
        
        if (nationalId.length !== 10) {
            setError(t('invalidRegistrationIdFormat'));
            setLoading(false);
            return;
        }

        const idType = detectIdType(nationalId);
        if (!idType) {
            setError(t('invalidRegistrationIdFormat'));
            setLoading(false);
            return;
        }
        
        if (phoneNumber.length !== 10 || !phoneNumber.startsWith('05')) {
            setError(t('invalidPhoneError'));
            setLoading(false);
            return;
        }

        if (!validatePassword(registerPassword)) {
            setError(t('invalidPasswordError'));
            setLoading(false);
            return;
        }

        if (registerPassword !== registerConfirmPassword) {
            setError(t('passwordMismatchError'));
            setLoading(false);
            return;
        }

        if (!agreedToPrivacy) {
            setError(t('mustAgreePrivacyError'));
            setLoading(false);
            return;
        }

        try {
            // step 1: the server sends a code, the account is created after it is confirmed
            const { data: started, error: registerError } = await startRegistration({
                national_id: nationalId,
                id_type: idType,
                full_name: registerName,
                phone_number: phoneNumber,
                password: registerPassword
            });

            if (registerError || !started) {
                const registerErrors = {
                    user_exists: 'userAlreadyExists',
                    otp_unavailable: 'otpUnavailableError',
                    otp_rate_limited: 'otpRateLimitedError',
                    otp_send_failed: 'otpSendFailedError',
                    rate_limited: 'tooManyAttemptsError',
                    invalid_phone: 'invalidPhoneError',
                    weak_password: 'invalidPasswordError',
                };
                setError(t(registerErrors[registerError] || 'registerError'));
                setLoading(false);
                return;
            }

            setRegOtp({
                actionId: started.actionId,
                maskedPhone: started.targets[0]?.maskedPhone,
                expiresInSeconds: started.expiresInSeconds,
                resendAfterSeconds: started.resendAfterSeconds
            });
            setMode('register_otp');

        } catch (error) {
            console.error("Registration error:", error);
            setError(t('registerError'));
        } finally {
            setLoading(false);
        }
    };

    // resend countdown
    useEffect(() => {
        if (resendSeconds <= 0) return undefined;
        const timer = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendSeconds]);

    const otpErrorMessage = (code) => {
        if (code === 'otp_unavailable') return t('otpUnavailableError');
        if (code === 'rate_limited') return t('tooManyAttemptsError');
        return t('resetPasswordError');
    };

    // send the code (first step and the resend button)
    const sendResetOtp = async () => {
        const nationalId = normalizeNumbers(resetId);
        const phoneNumber = normalizeNumbers(resetPhone);

        if (nationalId.length !== 10 || phoneNumber.length !== 10) {
            setError(t('invalidIdOrPhoneFormat'));
            return false;
        }

        const { data, error: otpError } = await requestResetOtp({ nationalId, phoneNumber });
        if (otpError || !data) {
            setError(otpErrorMessage(otpError));
            return false;
        }
        setOtpMinutes(Math.max(1, Math.round((data.expiresInSeconds || 300) / 60)));
        setResendSeconds(data.resendAfterSeconds || 60);
        setInfo(t('otpSentInfo'));
        return true;
    };

    const handleValidateResetRequest = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setInfo('');

        try {
            if (await sendResetOtp()) {
                setOtpCode('');
                setMode('set_new_password');
            }
        } catch (err) {
            console.error("Request reset code error:", err);
            setError(t('resetPasswordError'));
        } finally {
            setLoading(false);
        }
    };

    const handleResendOtp = async () => {
        setError('');
        setInfo('');
        setLoading(true);
        try {
            await sendResetOtp();
        } catch (err) {
            console.error("Resend reset code error:", err);
            setError(t('resetPasswordError'));
        } finally {
            setLoading(false);
        }
    };

    const handleSetNewPassword = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (normalizeNumbers(otpCode).replace(/\D/g, '').length !== 6) {
            setError(t('invalidOtpFormat'));
            setLoading(false);
            return;
        }

        if (!validatePassword(newPassword)) {
            setError(t('invalidPasswordError'));
            setLoading(false);
            return;
        }

        if (newPassword !== confirmNewPassword) {
            setError(t('passwordMismatchError'));
            setLoading(false);
            return;
        }

        try {
            const { data, error: resetError } = await resetPassword({
                nationalId: normalizeNumbers(resetId),
                phoneNumber: normalizeNumbers(resetPhone),
                otp: normalizeNumbers(otpCode).replace(/\D/g, ''),
                newPassword,
            });

            if (resetError || !data.success) {
                setError(resetError === 'invalid_code' ? t('invalidOtpError') : otpErrorMessage(resetError));
                setLoading(false);
                return;
            }

            alert(t('passwordResetSuccess'));
            setMode('login');
            resetForms();
        } catch (err) {
            console.error("Set new password error:", err);
            setError(t('resetPasswordError'));
        } finally {
            setLoading(false);
        }
    };

    const renderContent = () => {
        if (mode === 'login') {
            return (
                <motion.form 
                    key="login"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    onSubmit={handleLogin} 
                    className="space-y-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <IdCard className="w-4 h-4 ml-2" />
                            {t('id_or_phone_placeholder')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            value={loginId}
                            onChange={(e) => setLoginId(enforceNumeric(e.target.value).slice(0, 10))}
                            placeholder={t('id_or_phone_placeholder')}
                            required
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Lock className="w-4 h-4 ml-2" />
                            {t('password')}
                        </label>
                        <div className="relative">
                            <Input
                                type={showLoginPassword ? "text" : "password"}
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                placeholder={t('enterPassword')}
                                required
                                dir="ltr"
                                className="text-left pl-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowLoginPassword(!showLoginPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showLoginPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? t('logging_in') : t('login')}
                    </Button>
                    <div className="text-center space-y-2">
                        <button
                            type="button"
                            onClick={() => setMode('register')}
                            className="text-teal-600 hover:underline text-sm"
                        >
                            {t('register')}
                        </button>
                        <br />
                        <button
                            type="button"
                            onClick={() => setMode('reset')}
                            className="text-gray-600 hover:underline text-sm"
                        >
                            {t('forgotPassword')}
                        </button>
                    </div>
                </motion.form>
            );
        }

        if (mode === 'register') {
            return (
                <motion.form 
                    key="register"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    onSubmit={handleRegister} 
                    className="space-y-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <IdCard className="w-4 h-4 ml-2" />
                            {t('nationalId')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            value={registerId}
                            onChange={(e) => setRegisterId(enforceNumeric(e.target.value).slice(0, 10))}
                            placeholder={t('nationalId')}
                            required
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <User className="w-4 h-4 ml-2" />
                            {t('fullName')}
                        </label>
                        <Input
                            type="text"
                            value={registerName}
                            onChange={(e) => setRegisterName(enforceAlphabetic(e.target.value))}
                            placeholder={t('enterFullName')}
                            required
                            dir="rtl"
                            className="text-right"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Phone className="w-4 h-4 ml-2" />
                            {t('phoneNumber')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            value={registerPhone}
                            onChange={(e) => setRegisterPhone(enforceNumeric(e.target.value).slice(0, 10))}
                            placeholder="05xxxxxxxx"
                            required
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Key className="w-4 h-4 ml-2" />
                            {t('password')}
                        </label>
                        <div className="relative">
                            <Input
                                type={showRegisterPassword ? "text" : "password"}
                                value={registerPassword}
                                onChange={(e) => setRegisterPassword(e.target.value)}
                                placeholder={t('enterPassword')}
                                required
                                dir="ltr"
                                className="text-left pl-10"
                            />
                             <button
                                type="button"
                                onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showRegisterPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{t('passwordRequirements')}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Key className="w-4 h-4 ml-2" />
                            {t('confirmPassword')}
                        </label>
                        <div className="relative">
                            <Input
                                type={showRegisterConfirmPassword ? "text" : "password"}
                                value={registerConfirmPassword}
                                onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                                placeholder={t('confirmPasswordPlaceholder')}
                                required
                                dir="ltr"
                                className="text-left pl-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowRegisterConfirmPassword(!showRegisterConfirmPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showRegisterConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={agreedToPrivacy}
                            onChange={(e) => setAgreedToPrivacy(e.target.checked)}
                            className="mt-1 h-4 w-4 accent-teal-600"
                        />
                        <span>
                            {t('agreePrivacyBefore')}
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPrivacyPolicy(true); }}
                                className="text-teal-600 hover:text-teal-700 underline font-medium"
                            >
                                {t('privacyPolicyLink')}
                            </button>
                            {t('agreePrivacyAfter')}
                        </span>
                    </label>
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? t('registering') : t('register')}
                    </Button>
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className="text-teal-600 hover:underline text-sm"
                        >
                            {t('back')}
                        </button>
                    </div>
                </motion.form>
            );
        }

        if (mode === 'reset') {
            return (
                <motion.form 
                    key="reset"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    onSubmit={handleValidateResetRequest} 
                    className="space-y-4"
                >
                    <p className="text-sm text-gray-600 mb-4">{t('resetPasswordInstructions')}</p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <IdCard className="w-4 h-4 ml-2" />
                            {t('nationalId')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            value={resetId}
                            onChange={(e) => setResetId(enforceNumeric(e.target.value).slice(0, 10))}
                            placeholder={t('nationalId')}
                            required
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Phone className="w-4 h-4 ml-2" />
                            {t('phoneNumber')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            value={resetPhone}
                            onChange={(e) => setResetPhone(enforceNumeric(e.target.value).slice(0, 10))}
                            placeholder="05xxxxxxxx"
                            required
                            dir="ltr"
                            className="text-left"
                        />
                    </div>
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? t('sendingOtp') : t('sendOtpButton')}
                    </Button>
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className="text-teal-600 hover:underline text-sm"
                        >
                            {t('back')}
                        </button>
                    </div>
                </motion.form>
            );
        }
        
        if (mode === 'set_new_password') {
            return (
                <motion.form 
                    key="set_new_password"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    onSubmit={handleSetNewPassword} 
                    className="space-y-4"
                >
                    {info && (
                        <p className="text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-md p-3">
                            {info.replace('{minutes}', String(otpMinutes))}
                        </p>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Lock className="w-4 h-4 ml-2" />
                            {t('otpCodeLabel')}
                        </label>
                        <Input
                            type="tel"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={otpCode}
                            onChange={(e) => setOtpCode(enforceNumeric(e.target.value).slice(0, 6))}
                            placeholder="123456"
                            required
                            dir="ltr"
                            className="text-center tracking-[0.5em] text-lg"
                        />
                        <div className="mt-2 text-center">
                            <button
                                type="button"
                                onClick={handleResendOtp}
                                disabled={loading || resendSeconds > 0}
                                className="text-teal-600 hover:underline text-sm disabled:text-gray-400 disabled:no-underline"
                            >
                                {resendSeconds > 0
                                    ? t('resendOtpIn').replace('{seconds}', String(resendSeconds))
                                    : t('resendOtp')}
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-gray-600">{t('enterNewPassword')}</p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Key className="w-4 h-4 ml-2" />
                            {t('newPassword')}
                        </label>
                        <div className="relative">
                            <Input
                                type={showNewPassword ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={t('newPassword')}
                                required
                                dir="ltr"
                                className="text-left pl-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                         <p className="text-xs text-gray-500 mt-1">{t('passwordRequirements')}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <Key className="w-4 h-4 ml-2" />
                            {t('confirmPassword')}
                        </label>
                        <div className="relative">
                            <Input
                                type={showConfirmNewPassword ? "text" : "password"}
                                value={confirmNewPassword}
                                onChange={(e) => setConfirmNewPassword(e.target.value)}
                                placeholder={t('confirmPasswordPlaceholder')}
                                required
                                dir="ltr"
                                className="text-left pl-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirmNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? t('saving') : t('saveChanges')}
                    </Button>
                     <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className="text-teal-600 hover:underline text-sm"
                        >
                            {t('backToLogin')}
                        </button>
                    </div>
                </motion.form>
            );
        }
        if (mode === 'register_otp' && regOtp) {
            return (
                <motion.div
                    key="register_otp"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                >
                    <OtpCodesForm
                        key={regOtp.actionId}
                        t={t}
                        fields={[{ role: 'registrant', label: t('otpCodeRegistrant'), maskedPhone: regOtp.maskedPhone }]}
                        expiresInSeconds={regOtp.expiresInSeconds}
                        resendAfterSeconds={regOtp.resendAfterSeconds}
                        onConfirm={async (codes) => {
                            const { data: newUser, error: confirmError } = await confirmAction({ actionId: regOtp.actionId, codes });
                            if (confirmError === 'invalid_code' || confirmError === 'rate_limited' || confirmError === 'network_error') {
                                return { error: confirmError };
                            }
                            if (confirmError || !newUser) {
                                // e.g. the ID was registered in the meantime
                                setError(t(confirmError === 'user_exists' ? 'userAlreadyExists' : 'registerError'));
                                setRegOtp(null);
                                setMode('register');
                                return {};
                            }
                            setError('');
                            alert(t('registerSuccess') + ' ' + t('canLoginNow'));
                            setMode('login');
                            resetForms();
                            return {};
                        }}
                        onResend={async () => {
                            const { error: resendError } = await resendAction(regOtp.actionId);
                            return { error: resendError };
                        }}
                        onCancel={() => { setRegOtp(null); setMode('register'); }}
                    />
                </motion.div>
            );
        }
        return null;
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-bold flex items-center justify-center">
                        <UserCog className="w-6 h-6 ml-2 text-teal-600" />
                        {mode === 'login' ? t('userLoginTitle') : 
                         mode === 'register' ? t('register') : 
                         mode === 'register_otp' ? t('otpTitleRegister') : 
                         t('resetPassword')}
                    </DialogTitle>
                </DialogHeader>
                <div className="p-6">
                    <AnimatePresence mode="wait">
                        {renderContent()}
                    </AnimatePresence>
                </div>
                {/* Nested dialog: opens the same privacy-policy modal used in the footer */}
                <PrivacyPolicyModal
                    isOpen={showPrivacyPolicy}
                    onClose={() => setShowPrivacyPolicy(false)}
                    lang={lang}
                />
            </DialogContent>
        </Dialog>
    );
}
