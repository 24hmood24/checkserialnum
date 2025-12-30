
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff } from 'lucide-react';
import { updateUserProfile } from '@/api/functions';

export default function UserProfileTab({ user, t, onSave, onCancel }) {
  // Initialize formData with user details
  const [formData, setFormData] = useState({
    national_id: user.national_id || '',
    full_name: user.full_name || '',
    phone_number: user.phone_number || '',
    currentPassword: '',
    newPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');

  // Update formData when user prop changes
  useEffect(() => {
    setFormData({
      national_id: user.national_id || '',
      full_name: user.full_name || '',
      phone_number: user.phone_number || '',
      currentPassword: '',
      newPassword: '',
    });
    setError('');
  }, [user]);

  const validatePassword = (password) => {
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(password);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const updates = {
      full_name: formData.full_name,
      phone_number: formData.phone_number,
    };

    // Password change logic
    if (formData.newPassword) {
      if (!formData.currentPassword) {
        setError(t('currentPasswordRequiredForChange'));
        setLoading(false);
        return;
      }
      if (!validatePassword(formData.newPassword)) {
        setError(t('invalidPasswordError'));
        setLoading(false);
        return;
      }

      updates.current_password = formData.currentPassword;
      updates.new_password = formData.newPassword;
    }

    try {
      const { data: updatedUserResponse } = await updateUserProfile({
          userId: user.id,
          updates: updates
      });

      if (!updatedUserResponse) {
          throw new Error(t('updateError'));
      }

      onSave(updatedUserResponse, t('userInfoUpdatedSuccess'));

      // Clear password fields after successful update
      setFormData((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));

    } catch (apiError) {
       const errorMessage = apiError.response?.data?.error === "Incorrect current password"
            ? t('passwordIncorrectError')
            : (apiError.message || t('updateError'));
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">{t('editProfile')}</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="nationalId" className="block text-sm font-medium text-gray-700 mb-2">
            {t('nationalId')}
          </label>
          <Input
            id="nationalId"
            type="tel"
            inputMode="numeric"
            value={formData.national_id}
            disabled
            className="bg-gray-100 cursor-not-allowed"
            dir="ltr"
          />
          <p className="text-xs text-gray-500 mt-1">{t('cannotChangeNationalId')}</p>
        </div>

        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
            {t('fullName')}
          </label>
          <Input
            id="fullName"
            type="text"
            value={formData.full_name}
            onChange={(e) => setFormData({...formData, full_name: e.target.value})}
            required
            dir="rtl"
            className="text-right"
          />
        </div>

        <div>
          <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
            {t('phoneNumber')}
          </label>
          <Input
            id="phoneNumber"
            type="tel"
            inputMode="numeric"
            value={formData.phone_number}
            onChange={(e) => setFormData({...formData, phone_number: e.target.value.replace(/\D/g, '').slice(0, 10)})}
            placeholder="05xxxxxxxx"
            required
            dir="ltr"
            className="text-left"
          />
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('changePassword')}</h3>
          <p className="text-sm text-gray-600 mb-4">{t('changePasswordNote')}</p>

          <div className="space-y-4">
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-2">
                {t('currentPassword')}
              </label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  value={formData.currentPassword}
                  onChange={(e) => setFormData({...formData, currentPassword: e.target.value})}
                  dir="ltr"
                  className="text-left pl-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
                {t('newPassword')}
              </label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={formData.newPassword}
                  onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
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
          </div>
        </div>

        {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

        <div className="flex gap-4 pt-6">
          <Button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700">
            {loading ? t('saving') : t('saveChanges')}
          </Button>
          <Button type="button" onClick={onCancel} variant="outline" className="flex-1">
            {t('cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
