
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserCog, Lock, User, Phone, IdCard, Key, UserPlus, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { registerUser } from '@/api/functions';
import { loginUser } from '@/api/functions';
import { validateResetRequest } from '@/api/functions';
import { resetPassword } from '@/api/functions';

export default function UserLoginModal({ isOpen, onLoginSuccess, t, initialMode = 'login', onClose }) {
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

    // Reset password form
    const [resetId, setResetId] = useState('');
    const [resetPhone, setResetPhone] = useState('');
    const [userToResetId, setUserToResetId] = useState(null);
    const [newPassword, setNewPassword] = useState('');
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
        if (firstDigit === '7') return 'commercial_reg';
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
        setResetId('');
        setResetPhone('');
        setUserToResetId(null);
        setNewPassword('');
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
                identifier: identifier, 
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

        try {
            const { data: newUser, error: registerError } = await registerUser({
                national_id: nationalId,
                id_type: idType,
                full_name: registerName,
                phone_number: phoneNumber,
                password: registerPassword
            });

            if (registerError) {
                 if(registerError.response?.data?.error === 'user_exists') {
                    setError(t('userAlreadyExists'));
                 } else {
                    setError(t('registerError'));
                 }
                setLoading(false);
                return;
            }

            if (newUser) {
                setError('');
                alert(t('registerSuccess') + ' ' + t('canLoginNow'));
                setMode('login');
                resetForms();
            }

        } catch (error) {
            console.error("Registration error:", error);
            setError(t('registerError'));
        } finally {
            setLoading(false);
        }
    };

    const handleValidateResetRequest = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const nationalId = normalizeNumbers(resetId);
        const phoneNumber = normalizeNumbers(resetPhone);

        if (nationalId.length !== 10 || phoneNumber.length !== 10) {
            setError(t('invalidIdOrPhoneFormat'));
            setLoading(false);
            return;
        }

        try {
            const { data, error: validationError } = await validateResetRequest({ nationalId, phoneNumber });

            if (validationError || !data.success) {
                setError(t('userNotFound'));
                setLoading(false);
                return;
            }

            setUserToResetId(data.userId);
            setMode('set_new_password');
        } catch (err) {
            console.error("Validation reset request error:", err);
            setError(t('resetPasswordError'));
        } finally {
            setLoading(false);
        }
    };
    
    const handleSetNewPassword = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

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
            const { data, error: resetError } = await resetPassword({ userId: userToResetId, newPassword });

            if (resetError || !data.success) {
                setError(t('resetPasswordError'));
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
                            className="text-blue-600 hover:underline text-sm"
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
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? t('registering') : t('register')}
                    </Button>
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className="text-blue-600 hover:underline text-sm"
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
                        {loading ? t('verifying') : t('verifyButton')}
                    </Button>
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setMode('login')}
                            className="text-blue-600 hover:underline text-sm"
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
                    <p className="text-sm text-gray-600 mb-4">{t('enterNewPassword')}</p>
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
                            className="text-blue-600 hover:underline text-sm"
                        >
                            {t('backToLogin')}
                        </button>
                    </div>
                </motion.form>
            );
        }
        return null;
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md" dir="rtl">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-bold flex items-center justify-center">
                        <UserCog className="w-6 h-6 ml-2 text-blue-600" />
                        {mode === 'login' ? t('userLoginTitle') : 
                         mode === 'register' ? t('register') : 
                         t('resetPassword')}
                    </DialogTitle>
                </DialogHeader>
                <div className="p-6">
                    <AnimatePresence mode="wait">
                        {renderContent()}
                    </AnimatePresence>
                </div>
            </DialogContent>
        </Dialog>
    );
}
